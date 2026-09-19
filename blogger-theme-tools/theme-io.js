// theme-io.js dump <file> | apply <file>  — Blogger 테마 HTML 편집기(CodeMirror) 읽기/쓰기
const puppeteer = require("C:/Users/UserK/AppData/Local/Temp/claude/C--Users-UserK-Desktop--------/b6a8011d-1531-47b8-aeb0-ba3214ff8748/scratchpad/node_modules/puppeteer-core");
const fs = require("fs");
(async () => {
  const browser = await puppeteer.connect({ browserURL: "http://127.0.0.1:9225", defaultViewport: null });
  const pages = await browser.pages(); const page = pages[pages.length - 1];
  const [cmd, file] = process.argv.slice(2);
  if (cmd === "dump") {
    const val = await page.evaluate(() => { const cm = document.querySelector(".CodeMirror"); return cm && cm.CodeMirror ? cm.CodeMirror.getValue() : null; });
    if (val == null) console.log("NO CODEMIRROR"); else { fs.writeFileSync(file, val, "utf8"); console.log("dumped", val.length); }
  } else if (cmd === "apply") {
    const val = fs.readFileSync(file, "utf8");
    const r = await page.evaluate((v) => { const cm = document.querySelector(".CodeMirror"); if (!cm || !cm.CodeMirror) return "NO CODEMIRROR"; cm.CodeMirror.setValue(v); return "set " + cm.CodeMirror.getValue().length; }, val);
    console.log(r);
  }
  browser.disconnect();
})();
