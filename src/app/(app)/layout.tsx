import { Suspense } from "react";
import { CurrentProjectProvider } from "@/components/app/current-project";
import { AppFrame } from "@/components/app/nav";

/** Every signed-in page: the main navigation around the current project. */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense>
      <CurrentProjectProvider>
        <AppFrame>{children}</AppFrame>
      </CurrentProjectProvider>
    </Suspense>
  );
}
