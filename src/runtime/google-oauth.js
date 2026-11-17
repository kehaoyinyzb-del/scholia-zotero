// Google desktop OAuth uses a system browser and a short-lived loopback listener.
import { ReadingError } from '../domain/errors.js';
import { geminiBase } from '../domain/configuration.js';

const tokenURL = 'https://oauth2.googleapis.com/token';
const tokenKey = (id) => id + '@google-oauth';

function base64url(window, bytes) {
  return window
    .btoa(String.fromCharCode(...bytes))
    .replace(/=/gu, '')
    .replace(/\+/gu, '-')
    .replace(/\//gu, '_');
}

export class GoogleOAuth {
  constructor(environment, secrets, rootURI) {
    this.environment = environment;
    this.rootURI = rootURI;
    this.secrets = secrets;
    this.tokens = new Map();
  }

  releaseClient() {
    return JSON.parse(
      this.environment.Zotero.File.getContentsFromURL(this.rootURI + 'google-client.json'),
    );
  }

  async exchange(window, fields, signal) {
    const response = await window.fetch(tokenURL, {
      method: 'POST',
      redirect: 'error',
      credentials: 'omit',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new window.URLSearchParams(fields).toString(),
      signal: window.AbortSignal.any([signal, window.AbortSignal.timeout(30000)]),
    });
    const result = await response.json();
    if (!response.ok || !result.access_token) throw new ReadingError('google-auth');
    return result;
  }

  async credentials(provider, signal) {
    if (provider.baseURL !== geminiBase) throw new ReadingError('google-client');
    const stored = await this.secrets.get(tokenKey(provider.id));
    if (!stored) throw new ReadingError('google-auth');
    const { client, refresh } = JSON.parse(stored);
    const window = this.environment.Zotero.getMainWindow();
    let entry = this.tokens.get(provider.id);
    if (entry?.stored !== stored || entry.expires <= Date.now()) {
      const result = await this.exchange(
        window,
        {
          grant_type: 'refresh_token',
          client_id: client.id,
          client_secret: client.secret,
          refresh_token: refresh,
        },
        signal,
      );
      signal.throwIfAborted();
      if ((await this.secrets.get(tokenKey(provider.id))) !== stored)
        throw new ReadingError('google-auth');
      entry = {
        key: result.access_token,
        stored,
        expires: Date.now() + (result.expires_in - 60) * 1000,
      };
      this.tokens.set(provider.id, entry);
    }
    return { key: entry.key, project: client.project };
  }

  async connected(id) {
    return Boolean(await this.secrets.get(tokenKey(id)));
  }

  forget(id) {
    this.tokens.delete(id);
  }

  async login(window, provider, signal, onProgress) {
    const saved = await this.secrets.get(tokenKey(provider.id));
    const client = this.releaseClient() || (saved && JSON.parse(saved).client);
    if (!client) throw new ReadingError('google-client');
    const verifier = base64url(window, window.crypto.getRandomValues(new Uint8Array(48)));
    const state = base64url(window, window.crypto.getRandomValues(new Uint8Array(32)));
    const digest = await window.crypto.subtle.digest(
      'SHA-256',
      new window.TextEncoder().encode(verifier),
    );
    signal.throwIfAborted();
    const { HttpServer } = this.environment.ChromeUtils.importESModule(
      'chrome://remote/content/server/httpd.sys.mjs',
    );
    const server = new HttpServer();
    server.start(-1);
    try {
      const port = server.identity.primaryPort;
      const redirect = `http://127.0.0.1:${port}/`;
      const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      const fields = {
        client_id: client.id,
        redirect_uri: redirect,
        response_type: 'code',
        scope: 'https://www.googleapis.com/auth/cloud-platform',
        state,
        code_challenge: base64url(window, new Uint8Array(digest)),
        code_challenge_method: 'S256',
        access_type: 'offline',
        prompt: 'consent select_account',
      };
      for (const [key, value] of Object.entries(fields)) url.searchParams.set(key, value);
      const waitSignal = window.AbortSignal.any([signal, window.AbortSignal.timeout(300000)]);
      let abort;
      let code;
      try {
        code = await new Promise((resolve, reject) => {
          abort = () => reject(new ReadingError(signal.aborted ? 'cancelled' : 'login-timeout'));
          waitSignal.addEventListener('abort', abort, { once: true });
          server.registerPathHandler('/', (request, response) => {
            const params = new window.URLSearchParams(request.queryString);
            response.setHeader('Cache-Control', 'no-store', false);
            response.setHeader('Referrer-Policy', 'no-referrer', false);
            if (
              request.method !== 'GET' ||
              request.host !== '127.0.0.1' ||
              params.get('state') !== state
            ) {
              response.setStatusLine('1.1', 400, 'Bad Request');
              response.write('Invalid sign-in request.');
              return;
            }
            response.write('Return to Scholia in Zotero to see your sign-in result.');
            if (params.get('code') && !params.has('error')) resolve(params.get('code'));
            else reject(new ReadingError('google-auth'));
          });
          onProgress('请在浏览器中完成 Google 授权，随后返回 Zotero。');
          this.environment.Zotero.launchURL(url.href);
        });
      } finally {
        waitSignal.removeEventListener('abort', abort);
      }
      const result = await this.exchange(
        window,
        {
          client_id: client.id,
          client_secret: client.secret,
          grant_type: 'authorization_code',
          code,
          code_verifier: verifier,
          redirect_uri: redirect,
        },
        signal,
      );
      signal.throwIfAborted();
      if (!result.refresh_token) throw new ReadingError('google-auth');
      const stored = JSON.stringify({ client, refresh: result.refresh_token });
      await this.secrets.set(tokenKey(provider.id), stored);
      this.tokens.set(provider.id, {
        stored,
        key: result.access_token,
        expires: Date.now() + (result.expires_in - 60) * 1000,
      });
    } finally {
      await server.stop();
    }
  }
}
