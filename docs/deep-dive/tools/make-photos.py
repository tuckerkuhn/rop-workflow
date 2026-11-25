"""Makes two fictional sample photos for fake-kobo.mjs: a signed note with a date and place in its
EXIF data, and a handover photo without. Run in this folder:  python3 make-photos.py  (needs Pillow)"""
from PIL import Image, ImageDraw
from PIL.TiffImagePlugin import IFDRational

im = Image.new("RGB", (900, 1200), (250, 247, 235))
d = ImageDraw.Draw(im)
d.rectangle([40, 40, 860, 1160], outline=(60, 60, 60), width=3)
y = 90
for line in ["GOODS RECEIVED NOTE  (SAMPLE, fictional)", "", "Farmer ID: F-0000     Date: 2026-11-24", "", "Certified maize seed ........ 10 kg", "NPK 17-17-17 ................ 50 kg", "", "Received in acceptable condition.", "I am responsible for these goods from now on.", "", "", "Recipient (signature or thumbprint):"]:
    d.text((80, y), line, fill=(30, 30, 30))
    y += 58
d.ellipse([560, 760, 680, 900], fill=(120, 110, 160))

def dms(v):
    v = abs(v); deg = int(v); m = int((v - deg) * 60); s = ((v - deg) * 60 - m) * 60
    return (IFDRational(deg, 1), IFDRational(m, 1), IFDRational(int(s * 10000), 10000))

ex = Image.Exif()
ex[0x0132] = "2026:11:24 09:58:11"
ex.get_ifd(0x8769)[0x9003] = "2026:11:24 09:58:11"
g = ex.get_ifd(0x8825)
g[1] = "N"; g[2] = dms(34.5623); g[3] = "E"; g[4] = dms(69.2101)
im.save("note.jpg", "JPEG", quality=80, exif=ex)
im2 = Image.new("RGB", (900, 600), (196, 214, 190))
ImageDraw.Draw(im2).text((60, 60), "Handover photo (SAMPLE, fictional)", fill=(20, 40, 20))
im2.save("handover.jpg", "JPEG", quality=80)
print("wrote note.jpg and handover.jpg")
