const mangayomiSources = [{
  "id": 1735200244,
  "name": "ASMR基佬中心",
  "lang": "zh",
  "baseUrl": "https://www.asmrgay.com",
  "apiUrl": "",
  "iconUrl": "",
  "typeSource": "single",
  "itemType": 1,
  "isNsfw": true,
  "hasCloudflare": false,
  "version": "0.0.2",
  "dateFormat": "",
  "dateFormatLocale": "",
  "pkgPath": "anime/src/zh/asmrgay.js"
}];

const AUDIO_EXT = /\.(mp3|m4a|aac|flac|wav|ogg|opus|wma)$/i;

class DefaultExtension extends MProvider {
  getBaseUrl() {
    const preference = new SharedPreferences();
    var base = preference.get("domain_url");
    if (!base || base.length == 0) return this.source.baseUrl;
    return base.endsWith("/") ? base.slice(0, -1) : base;
  }

  getRoot() {
    const preference = new SharedPreferences();
    var root = preference.get("root_path");
    if (!root || root.length == 0) root = "/asmr/中文音声/步非烟";
    if (!root.startsWith("/")) root = "/" + root;
    return root.endsWith("/") && root.length > 1 ? root.slice(0, -1) : root;
  }

  async api(endpoint, body) {
    const res = await new Client().post(
      `${this.getBaseUrl()}/api/${endpoint}`,
      { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0" },
      body
    );
    const data = JSON.parse(res.body);
    if (data.code != 200) throw new Error(data.message);
    return data.data;
  }

  async listDir(path) {
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const data = await this.api("fs/list", { path: path, password: "", page: 1, per_page: 0, refresh: false });
        return data.content || [];
      } catch (e) {
        lastError = e;
      }
    }
    throw lastError;
  }

  cnToNum(s) {
    const digits = { "零": 0, "一": 1, "二": 2, "两": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9 };
    return s.replace(/[零一二两三四五六七八九十百]+/g, m => {
      let total = 0;
      let cur = 0;
      for (const c of m) {
        if (c == "百") {
          total += (cur || 1) * 100;
          cur = 0;
        } else if (c == "十") {
          total += (cur || 1) * 10;
          cur = 0;
        } else {
          cur = digits[c];
        }
      }
      return String(total + cur);
    });
  }

  naturalCompare(a, b) {
    const ax = this.cnToNum(a).match(/(\d+|\D+)/g) || [];
    const bx = this.cnToNum(b).match(/(\d+|\D+)/g) || [];
    for (let i = 0; i < Math.min(ax.length, bx.length); i++) {
      const an = parseInt(ax[i]);
      const bn = parseInt(bx[i]);
      if (!isNaN(an) && !isNaN(bn)) {
        if (an != bn) return an - bn;
      } else if (ax[i] != bx[i]) {
        return ax[i] < bx[i] ? -1 : 1;
      }
    }
    return ax.length - bx.length;
  }

  joinPath(parent, name) {
    return parent.endsWith("/") ? parent + name : parent + "/" + name;
  }

  baseName(path) {
    return path.split("/").pop();
  }

  seriesTitle(path) {
    const root = this.getRoot();
    const rootName = this.baseName(root);
    if (path == root) return rootName;
    const rel = path.startsWith(root + "/") ? path.slice(root.length + 1) : this.baseName(path);
    return `${rootName} ${rel.split("/").join(" ")}`;
  }

  async getSeries(sortByTime) {
    const root = this.getRoot();
    const items = await this.listDir(root);
    const dirs = items.filter(x => x.is_dir);
    const list = [];
    if (dirs.length == 0) {
      list.push({ name: this.seriesTitle(root), link: root, imageUrl: "" });
    } else {
      if (sortByTime) {
        dirs.sort((a, b) => (a.modified < b.modified ? 1 : -1));
      } else {
        dirs.sort((a, b) => this.naturalCompare(a.name, b.name));
      }
      for (const d of dirs) {
        const p = this.joinPath(root, d.name);
        list.push({ name: this.seriesTitle(p), link: p, imageUrl: d.thumb || "" });
      }
    }
    return { list: list, hasNextPage: false };
  }

  async getPopular(page) {
    return await this.getSeries(false);
  }

  async getLatestUpdates(page) {
    return await this.getSeries(true);
  }

  async search(query, page, filters) {
    if (!query || query.trim().length == 0) {
      return await this.getSeries(false);
    }
    const perPage = 50;
    const data = await this.api("fs/search", {
      parent: this.getRoot(),
      keywords: query.trim(),
      scope: 0,
      page: page,
      per_page: perPage,
      password: ""
    });
    const list = [];
    for (const x of data.content || []) {
      if (!x.is_dir && !AUDIO_EXT.test(x.name)) continue;
      const p = this.joinPath(x.parent, x.name);
      list.push({
        name: x.is_dir ? this.seriesTitle(p) : x.name.replace(AUDIO_EXT, ""),
        link: p,
        imageUrl: ""
      });
    }
    return { list: list, hasNextPage: page * perPage < (data.total || 0) };
  }

  async collectAudio(root, out) {
    const queue = [];
    const handle = async (path) => {
      const items = await this.listDir(path);
      for (const x of items) {
        const p = this.joinPath(path, x.name);
        if (x.is_dir) {
          queue.push(p);
        } else if (AUDIO_EXT.test(x.name)) {
          out.push({ path: p, name: x.name, parent: path, modified: x.modified, size: x.size });
        }
      }
    };
    const worker = async () => {
      while (queue.length > 0) {
        await handle(queue.shift());
      }
    };
    await handle(root);
    await Promise.all([worker(), worker(), worker(), worker()]);
  }

  async getDetail(url) {
    const path = url;
    const isFile = AUDIO_EXT.test(path);
    const files = [];
    if (isFile) {
      const info = await this.api("fs/get", { path: path, password: "" });
      files.push({ path: path, name: info.name, parent: path.slice(0, path.lastIndexOf("/")), modified: info.modified, size: info.size });
    } else {
      await this.collectAudio(path, files);
    }
    files.sort((a, b) => this.naturalCompare(a.path, b.path));

    const episodes = files.map(f => ({
      name: f.name.replace(AUDIO_EXT, ""),
      url: f.path,
      scanlator: f.parent.slice(f.parent.lastIndexOf("/") + 1),
      dateUpload: f.modified ? String(new Date(f.modified).getTime()) : null
    })).reverse();

    const sizeMb = Math.round(files.reduce((s, f) => s + (f.size || 0), 0) / 1048576);
    return {
      name: isFile ? this.baseName(path).replace(AUDIO_EXT, "") : this.seriesTitle(path),
      imageUrl: "",
      description: `${path}\n共 ${files.length} 集 · ${sizeMb} MB`,
      author: this.baseName(this.getRoot()),
      genre: ["音声"],
      status: 1,
      episodes: episodes
    };
  }

  async getVideoList(url) {
    const info = await this.api("fs/get", { path: url, password: "" });
    const ext = (info.name.match(AUDIO_EXT) || ["", "audio"])[1].toUpperCase();
    return [{
      url: info.raw_url,
      originalUrl: info.raw_url,
      quality: ext,
      headers: { "User-Agent": "Mozilla/5.0" }
    }];
  }

  getFilterList() {
    return [];
  }

  getSourcePreferences() {
    return [{
      "key": "root_path",
      "editTextPreference": {
        "title": "目录",
        "summary": "要浏览的目录，其下每个子文件夹为一个系列",
        "value": "/asmr/中文音声/步非烟",
        "dialogTitle": "目录",
        "dialogMessage": ""
      }
    }, {
      "key": "domain_url",
      "editTextPreference": {
        "title": "網址",
        "summary": "站點域名，換域名時修改",
        "value": "https://www.asmrgay.com",
        "dialogTitle": "網址",
        "dialogMessage": ""
      }
    }];
  }
}
