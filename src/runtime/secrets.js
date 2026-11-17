/** Secrets have a dedicated service boundary. Preferences and export code cannot enumerate them. */
export class SecretStore {
  constructor(services, components) {
    this.logins = services.logins;
    this.components = components;
    this.origin = 'chrome://reading-companion';
  }

  find(identifier) {
    return this.logins.findLogins(this.origin, null, `Reading Companion ${identifier}`);
  }

  removeProvider(identifier) {
    const realm = 'Reading Companion ' + identifier;
    const records = this.logins.findLogins(this.origin, null, '');
    for (const record of records) {
      if (record.httpRealm === realm || record.httpRealm?.startsWith(realm + '@'))
        this.logins.removeLogin(record);
    }
  }

  async get(identifier) {
    return this.find(identifier)[0]?.password || '';
  }

  async set(identifier, value) {
    const existing = this.find(identifier);
    if (!value) {
      existing.forEach((login) => this.logins.removeLogin(login));
      return;
    }
    const { classes, interfaces } = this.components;
    const login = classes['@mozilla.org/login-manager/loginInfo;1'].createInstance(
      interfaces.nsILoginInfo,
    );
    login.init(this.origin, null, `Reading Companion ${identifier}`, identifier, value, '', '');
    if (existing.length) {
      this.logins.modifyLogin(existing[0], login);
    } else {
      await this.logins.addLoginAsync(login);
    }
  }
}
