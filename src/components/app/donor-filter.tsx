"use client";

import { useT } from "@/components/app/i18n";
import { usePersistentState } from "@/components/workspace/ui";
import type { DonorInfo } from "@/lib/progress";

/**
 * Which donor Progress and Tasks are showing, remembered per project in this browser.
 * null means all donors. With one donor (or none) there is nothing to choose.
 */
export function useDonorChoice(projectCode: string, donors: DonorInfo[]) {
  const [picked, setPicked] = usePersistentState<string | null>(`rop-donor-${projectCode}`, () => null);
  const donor = donors.length === 1 ? donors[0] : (donors.find((d) => d.id === picked) ?? null);
  return { donor, setDonor: setPicked, choose: donors.length > 1 };
}

export function DonorFilter({ donors, donor, onChange }: { donors: DonorInfo[]; donor: DonorInfo | null; onChange: (id: string | null) => void }) {
  const { t } = useT();
  if (donors.length < 2) return null;
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-muted">{t("donor.filter")}</span>
      <select value={donor?.id ?? ""} onChange={(e) => onChange(e.target.value || null)} className="max-w-[16rem] truncate rounded-full border border-line bg-surface py-2 ps-3 pe-8">
        <option value="">{t("donor.all")}</option>
        {donors.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </select>
    </label>
  );
}
