// CDP로 띄워둔 Chrome(9225) 원격 조종 헬퍼
const puppeteer = require("C:\\Users\\UserK\\AppData\\Local\\Temp\\claude\\C--Users-UserK-Desktop--------\\b6a8011d-1531-47b8-aeb0-ba3214ff8748\\scratchpad\\node_modules\\puppeteer-core");

(async () => {
  const browser = await puppeteer.connect({ browserURL: "http://127.0.0.1:9225", defaultViewport: null });
  const pages = await browser.pages();
  const page = pages[pages.length - 1];
  const [cmd, a, b] = process.argv.slice(2);
  try {
    if (cmd === "goto") { await page.goto(a, { waitUntil: "domcontentloaded", timeout: 60000 }); }
    else if (cmd === "click") { await page.mouse.click(Number(a), Number(b)); }
    else if (cmd === "sel") { await page.waitForSelector(a, { timeout: 8000 }); await page.click(a); }
    else if (cmd === "type") { await page.keyboard.type(a, { delay: 20 }); }
    else if (cmd === "press") { await page.keyboard.press(a); }
    else if (cmd === "scroll") { await page.evaluate((y) => window.scrollBy(0, Number(y)), a); }
    else if (cmd === "text") { await page.waitForSelector(a, { timeout: 8000 }); await page.click(a, { clickCount: 3 }); await page.keyboard.type(b, { delay: 20 }); }
    else if (cmd === "eval") { const r = await page.evaluate(a); console.log(JSON.stringify(r).slice(0, 6000)); }
    else if (cmd === "frames") { console.log(page.frames().map((f, i) => i + ": " + f.url().slice(0, 120)).join("\n")); }
    else if (cmd === "feval") { // a=frame url 부분문자열, b=code
      const f = page.frames().find((fr) => fr.url().includes(a));
      if (!f) { console.log("FRAME NOT FOUND"); } else { const r = await f.evaluate(b); console.log(JSON.stringify(r).slice(0, 8000)); }
    }
    else if (cmd === "fevalf") { // a=frame url 부분, b=JS 파일 경로
      const fs = require("fs");
      let code = fs.readFileSync(b, "utf8");
      const extra = process.argv[5];
      if (extra !== undefined) code = code.split("__ARG__").join(extra);
      const f = page.frames().find((fr) => fr.url().includes(a));
      if (!f) { console.log("FRAME NOT FOUND"); } else { const r = await f.evaluate(code); console.log(JSON.stringify(r).slice(0, 8000)); }
    }
    else if (cmd === "fclick") { // a=frame url 부분, b=셀렉터
      const f = page.frames().find((fr) => fr.url().includes(a));
      if (!f) { console.log("FRAME NOT FOUND"); } else { await f.click(b); console.log("CLICKED"); }
    }
    else if (cmd === "fbtn") { // a=frame url 부분, b=aria-label 또는 버튼 텍스트
      const f = page.frames().find((fr) => fr.url().includes(a));
      if (!f) { console.log("FRAME NOT FOUND"); }
      else {
        const h = await f.evaluateHandle((label) => {
          const els = [...document.querySelectorAll('button, [role=button], [role=menuitem], a')];
          return els.find(e => e.offsetHeight > 0 && ((e.getAttribute('aria-label') || '').trim() === label || (e.innerText || '').trim() === label)) || null;
        }, b);
        const el = h.asElement();
        if (!el) { console.log("BTN NOT FOUND: " + b); } else { await el.click(); console.log("CLICKED: " + b); }
      }
    }
    else if (cmd === "ftype") { // a=frame url 부분, b=텍스트 (현재 포커스된 입력란에 타이핑)
      await page.keyboard.type(b, { delay: 15 });
    }
    else if (cmd === "setfiles") { // a=파일들(;구분) — 페이지/프레임의 input[type=file]에 직접 주입
      const files = a.split(";");
      let done = false;
      for (const f of page.frames()) {
        try {
          const inputs = await f.$$("input[type=file]");
          if (inputs.length) {
            await inputs[inputs.length - 1].uploadFile(...files);
            console.log("SET on frame " + f.url().slice(0, 80) + " inputs=" + inputs.length);
            done = true;
            break;
          }
        } catch (e) {}
      }
      if (!done) console.log("NO file input found");
    }
    else if (cmd === "upload") {
      // a = 클릭할 좌표 "x,y" 또는 셀렉터, b = 파일들(;구분)
      const files = b.split(";");
      const [chooser] = await Promise.all([
        page.waitForFileChooser({ timeout: 15000 }),
        a.includes(",") && !a.match(/[a-zA-Z\[\.#]/) ? page.mouse.click(Number(a.split(",")[0]), Number(a.split(",")[1])) : page.click(a),
      ]);
      await chooser.accept(files);
      console.log("UPLOADED:", files.length, "files");
    }
    await new Promise((r) => setTimeout(r, cmd === "goto" ? 3000 : 1800));
    const file = (cmd === "shot" && a) ? a : "screen.png";
    try { await page.screenshot({ path: __dirname + "/" + file }); } catch (e) {
      const ps = await browser.pages();
      await ps[ps.length - 1].screenshot({ path: __dirname + "/" + file });
    }
    console.log("URL:", page.url());
  } finally {
    await browser.disconnect();
  }
})();
