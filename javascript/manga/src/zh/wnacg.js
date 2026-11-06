const mangayomiSources = [{
  "id": 1735200243,
  "name": "紳士漫畫",
  "lang": "zh",
  "baseUrl": "https://www.wnacg.com",
  "apiUrl": "",
  "iconUrl": "",
  "typeSource": "single",
  "itemType": 0,
  "isNsfw": true,
  "hasCloudflare": true,
  "version": "0.0.3",
  "dateFormat": "",
  "dateFormatLocale": "",
  "pkgName": "manga/src/zh/wnacg.js"
}];

class DefaultExtension extends MProvider {
  getBaseUrl() {
    const preference = new SharedPreferences();
    var base = preference.get("domain_url");
    if (!base || base.length == 0) {
      return this.source.baseUrl;
    }
    if (base.endsWith("/")) {
      return base.slice(0, -1);
    }
    return base;
  }

  getHeaders() {
    return {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      "Referer": this.getBaseUrl() + "/"
    };
  }

  fixUrl(u) {
    if (!u) return "";
    u = u.trim().replace(/^\/+/, "//");
    if (u.startsWith("//")) return "https:" + u;
    if (u.startsWith("/")) return this.getBaseUrl() + u;
    return u;
  }

  async parseList(url) {
    const res = await new Client().get(url, this.getHeaders());
    const doc = new Document(res.body);
    const items = doc.select("li.gallary_item");
    const list = [];
    for (const item of items) {
      const a = item.selectFirst("div.title a");
      const img = item.selectFirst("img");
      if (!a) continue;
      list.push({
        name: a.attr("title") || a.text,
        link: a.attr("href"),
        imageUrl: img ? this.fixUrl(img.attr("src")) : ""
      });
    }
    let hasNextPage = doc.selectFirst("span.next a") != null;
    if (!hasNextPage) {
      const cur = doc.selectFirst("div.paginator span.thispage");
      const curNum = cur ? parseInt(cur.text) : 0;
      for (const a of doc.select("div.paginator a")) {
        if (parseInt(a.text) > curNum) {
          hasNextPage = true;
          break;
        }
      }
    }
    return { list: list, hasNextPage: hasNextPage };
  }

  async getPopular(page) {
    return await this.parseList(`${this.getBaseUrl()}/albums-index-page-${page}.html`);
  }

  async getLatestUpdates(page) {
    return await this.parseList(`${this.getBaseUrl()}/albums-index-page-${page}.html`);
  }

  async search(query, page, filters) {
    if (query && query.length > 0) {
      const url = `${this.getBaseUrl()}/search/index.php?q=${encodeURIComponent(query)}&m=&syn=yes&f=_all&s=create_time_DESC&p=${page}`;
      return await this.parseList(url);
    }
    if (filters && filters.length > 0) {
      const cate = filters[0]["values"][filters[0]["state"]]["value"];
      if (cate.length > 0) {
        return await this.parseList(`${this.getBaseUrl()}/albums-index-page-${page}-cate-${cate}.html`);
      }
      const tag = (filters[1] && filters[1]["state"]) ? filters[1]["state"].trim() : "";
      if (tag.length > 0) {
        return await this.parseList(`${this.getBaseUrl()}/albums-index-page-${page}-tag-${encodeURIComponent(tag)}.html`);
      }
    }
    return await this.parseList(`${this.getBaseUrl()}/albums-index-page-${page}.html`);
  }

  async getDetail(url) {
    const aid = url.match(/aid-(\d+)/)[1];
    const res = await new Client().get(`${this.getBaseUrl()}/photos-index-aid-${aid}.html`, this.getHeaders());
    const doc = new Document(res.body);

    const name = doc.selectFirst("div#bodywrap h2").text;
    const cover = this.fixUrl(doc.selectFirst("div.uwthumb img").attr("src"));

    const labels = doc.select("div.uwconn label");
    let category = "";
    let pages = "";
    for (const l of labels) {
      const t = l.text;
      if (t.startsWith("分類：")) category = t.replace("分類：", "");
      if (t.startsWith("頁數：")) pages = t.replace("頁數：", "");
    }

    const genre = [];
    const seen = {};
    for (const t of doc.select("div.addtags a.tagshow")) {
      const g = t.text;
      if (!seen[g]) {
        seen[g] = true;
        genre.push(g);
      }
    }
    if (category.length > 0) genre.unshift(category);

    const intro = doc.selectFirst("div.uwconn p");
    const description = intro ? intro.text : "";

    return {
      name: name,
      imageUrl: cover,
      description: description + (pages.length > 0 ? `\n頁數：${pages}` : ""),
      status: 1,
      genre: genre,
      episodes: [{
        name: name,
        url: `/photos-item-aid-${aid}.html`
      }]
    };
  }

  async getPageList(url) {
    const res = await new Client().get(this.getBaseUrl() + url, this.getHeaders());
    const m = res.body.match(/"page_url":\[(.*?)\]/);
    if (!m) return [];
    const urls = m[1].match(/"[^"]+"/g) || [];
    const pages = [];
    for (const raw of urls) {
      const u = raw.slice(1, -1).replace(/\\\//g, "/").replace(/^http:\/\//, "https://");
      pages.push({
        url: this.fixUrl(u),
        headers: this.getHeaders()
      });
    }
    return pages;
  }

  getFilterList() {
    const cates = [
      ["不使用分類", ""],
      ["同人誌", "5"],
      ["同人誌 / 漢化", "1"],
      ["同人誌 / 日語", "12"],
      ["同人誌 / English", "16"],
      ["單行本", "6"],
      ["單行本 / 漢化", "9"],
      ["單行本 / 日語", "13"],
      ["單行本 / English", "17"],
      ["雜誌&短篇", "7"],
      ["雜誌&短篇 / 漢化", "10"],
      ["雜誌&短篇 / 日語", "14"],
      ["雜誌&短篇 / English", "18"],
      ["CG畫集", "2"],
      ["AI圖集", "37"],
      ["3D漫畫", "22"],
      ["Cosplay", "3"]
    ];
    return [{
      type: "category",
      name: "分類",
      type_name: "SelectFilter",
      values: cates.map(c => ({ type_name: "SelectOption", name: c[0], value: c[1] }))
    }, {
      type: "tag",
      name: "標籤（分類選「不使用分類」時生效）",
      type_name: "TextFilter",
      state: ""
    }];
  }

  getSourcePreferences() {
    return [{
      "key": "domain_url",
      "editTextPreference": {
        "title": "網址",
        "summary": "站點域名，換域名時修改",
        "value": "https://www.wnacg.com",
        "dialogTitle": "網址",
        "dialogMessage": ""
      }
    }];
  }
}
