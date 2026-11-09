import type { Metadata } from "next";
import { PhotosPage } from "@/components/progress/photos-page";

export const metadata: Metadata = { title: "Photos and posts · ROP Workflow", description: "Tips on field photos, the photo library, and posts for donors, traders and ROP's channels." };

export default function Page() {
  return <PhotosPage />;
}
