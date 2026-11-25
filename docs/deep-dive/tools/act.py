"""Opens one page of the local test app as a demo person on a phone-sized screen, then does what it
is told, in order, and prints every request that changed something or failed.
  python3 act.py <user> <path> 'click:Words on the button' 'click:Same words#1' 'wait:2000' 'dump:name' 'shot:name' 'links:' 'goto:/path'
click:Text presses the first thing with those words, click:Text#1 the second (the page's own
"are you sure" box repeats the button's words). dump:name prints the page's words and saves
name.txt. shot:name saves name.png. btn:Words presses a button by its name (btnx: the exact name).
fields: lists the form's fields. 'label:Label words|value' types into a field, 'sel:#id|value' picks from
a list, 'file:main input[type=file]|/path/photo.jpg' attaches a file. links: lists the links and buttons. A user who does not
exist ("nobody") opens a page with no sign-in, as a donor opens a share link."""
import sys, json, asyncio
from playwright.async_api import async_playwright
async def main():
    user, path, *acts = sys.argv[1:]
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={"width": 390, "height": 900})
        page = await ctx.new_page()
        async def dlg(d):
            print("DIALOG", d.type, d.message[:400]); await d.accept()
        page.on("dialog", dlg)
        page.on("pageerror", lambda e: print("PAGEERROR", str(e)[:300]))
        page.on("response", lambda r: print("HTTP", r.status, r.request.method, r.url[21:140]) if (r.status >= 400 or r.request.method != "GET") else None)
        await page.goto("http://localhost:3000/about", wait_until="domcontentloaded")
        await page.evaluate("(u) => localStorage.setItem('rop-session-v1', JSON.stringify({userId:u}))", user)
        try:
            await page.goto("http://localhost:3000" + path, wait_until="networkidle", timeout=90000)
        except Exception as e:
            print("timeout", e)
        await page.wait_for_timeout(2500)
        for a in acts:
            k, _, v = a.partition(":")
            try:
                if k == "click":
                    n = 0
                    if "#" in v and v.rsplit("#",1)[1].isdigit():
                        v, n = v.rsplit("#",1); n = int(n)
                    await page.get_by_text(v, exact=False).nth(n).click(timeout=8000)
                    await page.wait_for_timeout(2500)
                elif k == "role":
                    r, name = v.split("|")
                    await page.get_by_role(r, name=name).first.click(timeout=8000)
                    await page.wait_for_timeout(2500)
                elif k == "css":
                    await page.locator(v).first.click(timeout=8000)
                    await page.wait_for_timeout(2500)
                elif k == "btn":
                    n = 0
                    if "#" in v and v.rsplit("#",1)[1].isdigit():
                        v, n = v.rsplit("#",1); n = int(n)
                    await page.get_by_role("button", name=v).nth(n).click(timeout=8000)
                    await page.wait_for_timeout(2500)
                elif k == "btnx":
                    await page.get_by_role("button", name=v, exact=True).first.click(timeout=8000)
                    await page.wait_for_timeout(3000)
                elif k == "sel":
                    sel, val = v.split("|")
                    await page.locator(sel).first.select_option(val); await page.wait_for_timeout(800)
                elif k == "label":
                    lab, val = v.split("|")
                    await page.get_by_label(lab, exact=False).first.fill(val)
                elif k == "file":
                    sel, val = v.split("|")
                    await page.locator(sel).first.set_input_files(val); await page.wait_for_timeout(3000)
                elif k == "fields":
                    fs = await page.eval_on_selector_all("main input, main textarea, main select", "els => els.map(e => e.tagName + ' type=' + (e.type||'') + ' id=' + (e.id||'') + ' aria=' + (e.getAttribute('aria-label')||'') + ' label=' + (e.labels && e.labels[0] ? e.labels[0].innerText.replace(/\\n/g,' ').slice(0,60) : '') + ' val=' + String(e.value).slice(0,30))")
                    print("\n".join(fs))
                elif k == "fill":
                    sel, val = v.split("|")
                    await page.locator(sel).first.fill(val)
                elif k == "wait":
                    await page.wait_for_timeout(int(v))
                elif k == "goto":
                    await page.goto("http://localhost:3000" + v, wait_until="networkidle", timeout=90000); await page.wait_for_timeout(2500)
                elif k == "dump":
                    t = await page.inner_text("body")
                    open(v + ".txt", "w").write(t)
                    print(f"=== {v} URL {page.url}")
                    print("\n".join(l for l in t.splitlines() if l.strip()))
                elif k == "shot":
                    await page.screenshot(path=v + ".png", full_page=True)
                elif k == "links":
                    hs = await page.eval_on_selector_all("main a, main button", "els => els.map(e => (e.tagName==='A' ? 'A ' + e.getAttribute('href') : 'B') + ' | ' + e.innerText.replace(/\\n/g,' ').slice(0,70))")
                    print("\n".join(hs))
            except Exception as e:
                print("ACT FAILED", a, str(e)[:200])
        await b.close()
asyncio.run(main())
