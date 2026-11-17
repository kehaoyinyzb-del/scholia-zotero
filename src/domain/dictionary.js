const normalize = (text) => text.normalize('NFKC').trim().toLocaleLowerCase();

export class OfflineDictionary {
  constructor(entries = []) {
    this.words = new Map(entries.map((entry) => [normalize(entry.word), entry]));
    this.forms = new Map();
    for (const entry of entries) {
      for (const field of (entry.exchange || '').split('/')) {
        const [kind, ...pieces] = field.split(':');
        if (!['p', 'd', 'i', '3', 'r', 't', 's'].includes(kind)) continue;
        for (const form of pieces.join(':').split(',')) {
          if (!form) continue;
          const key = normalize(form);
          const lemmas = this.forms.get(key) || [];
          if (!lemmas.includes(entry.word)) lemmas.push(entry.word);
          this.forms.set(key, lemmas);
        }
      }
    }
  }

  lookup(selected) {
    const key = normalize(selected);
    const candidates = [key, ...(this.forms.get(key) || [])];
    const entry = candidates.map((word) => this.words.get(word)).find(Boolean);
    if (!entry) return null;
    const lines = entry.translation.replace(/\\n/gu, '\n').split('\n');
    const first = lines.find((line) => !line.startsWith('[')) || lines[0];
    const part = /^([a-z./]+)\s+/iu.exec(first);
    return {
      lemma: entry.word,
      phonetic: entry.phonetic,
      meaning: first
        .replace(/^[a-z./]+\s+/iu, '')
        .split(/[,，；;]/u)
        .slice(0, 3)
        .join('；'),
      partOfSpeech: part?.[1] || '',
      alternatives: lines.join('；'),
      lemmas: [...new Set(candidates.filter((word) => this.words.has(word)))],
    };
  }
}
