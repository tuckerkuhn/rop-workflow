"""Opens pages of the local test app as a demo person on a phone-sized screen and saves each as
<name>.png and <name>.txt (the page's words).  python3 walk.py "user|/path|name" ...
Sign-in: demo mode reads the person from localStorage key rop-session-v1."""
import sys, json, asyncio
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        for spec in sys.argv[1:]:
            user, path, name = spec.split("|")
            ctx = await b.new_context(viewport={"width": 390, "height": 900})
            page = await ctx.new_page()
            await page.goto("http://localhost:3000/about", wait_until="domcontentloaded")
            await page.evaluate("(u) => localStorage.setItem('rop-session-v1', JSON.stringify({userId:u}))", user)
            try:
                await page.goto("http://localhost:3000" + path, wait_until="networkidle", timeout=90000)
            except Exception as e:
                print(name, "timeout", e)
            await page.wait_for_timeout(3500)
            await page.screenshot(path=f"{name}.png", full_page=True)
            open(f"{name}.txt", "w").write(await page.inner_text("body"))
            await ctx.close()
        await b.close()
asyncio.run(main())
