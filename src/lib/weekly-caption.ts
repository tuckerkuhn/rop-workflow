import { longDate } from "@/lib/weekly";

/**
 * A photo caption with the day it was taken, unless the caption already names a year. Kept apart
 * from lib/weekly-docx so the weekly page can show captions without loading the `docx` library;
 * weekly-docx words its figures the same way (tested in weekly-caption.test.ts).
 */
export const captionWithDate = (caption: string, taken?: string) => {
  const c = caption.trim().replace(/[.\s]+$/, "");
  return taken && !/\b20\d\d\b/.test(c) ? `${c}, ${longDate(taken)}` : c;
};
