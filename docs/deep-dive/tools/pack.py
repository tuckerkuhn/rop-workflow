"""Downloads a pack from the quarterly report page of the local test app as a demo person, on a
phone-sized screen, and prints its file list, README.txt and index.csv.
  python3 pack.py marcus "Evidence pack 2026 Q4" donor.zip
  python3 pack.py marcus "Audit pack (zip)" audit.zip"""
import sys, asyncio, zipfile, io
from playwright.async_api import async_playwright
async def main():
    user, words, out = sys.argv[1:4]
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={"width": 390, "height": 900}, accept_downloads=True)
        page = await ctx.new_page()
        page.on("response", lambda r: print("HTTP", r.status, r.request.method, r.url[21:140]) if r.status >= 400 else None)
        await page.goto("http://localhost:3000/about", wait_until="domcontentloaded")
        await page.evaluate("(u) => localStorage.setItem('rop-session-v1', JSON.stringify({userId:u}))", user)
        await page.goto("http://localhost:3000/progress/report?q=2026-Q4", wait_until="networkidle", timeout=90000)
        await page.wait_for_timeout(2500)
        await page.get_by_text("Send and share", exact=False).first.click()
        await page.wait_for_timeout(1500)
        t = await page.inner_text("body")
        i = t.find("Also download")
        print("PAGE:", t[i:i+300].replace("\n", " | "))
        if await page.get_by_text(words, exact=False).count() == 0:
            print("NO BUTTON:", words); return
        async with page.expect_download(timeout=60000) as d:
            await page.get_by_text(words, exact=False).first.click()
        dl = await d.value
        await dl.save_as(out)
        print("saved", dl.suggested_filename)
        await b.close()
    z = zipfile.ZipFile(out)
    for n in z.namelist():
        print("FILE", n, z.getinfo(n).file_size)
    print(z.read("README.txt").decode())
    print(z.read("index.csv").decode("utf-8-sig"))
asyncio.run(main())
