import { forwardRef } from "react";

import { StatusPill } from "@/components/ui/status-pill";

/** Application queue demo — separate from hero; only the header peeks at initial scroll. */
export const ApplicationQueuePreview = forwardRef<HTMLDivElement>(function ApplicationQueuePreview(_, ref) {
  return (
    <section aria-labelledby="queue-heading" className="relative z-20 -mt-14 px-5 pb-16 sm:-mt-16 sm:px-8">
      <div
        ref={ref}
        className="mx-auto max-w-4xl overflow-hidden rounded-2xl border border-line bg-white shadow-[0_24px_80px_-40px_rgba(14,14,14,0.25)]"
      >
        <div className="flex items-center justify-between border-b border-line bg-white px-5 py-3">
          <p id="queue-heading" className="text-sm font-medium">
            Application queue
          </p>
          <StatusPill tone="mint">Live tracking</StatusPill>
        </div>
        <table className="w-full bg-white text-left text-sm">
          <thead className="bg-white text-xs uppercase tracking-wider text-ink-muted">
            <tr className="border-b border-line">
              <th className="px-5 py-3 font-medium">Opportunity</th>
              <th className="px-5 py-3 font-medium">Status</th>
              <th className="hidden px-5 py-3 font-medium sm:table-cell">Deadline</th>
              <th className="hidden px-5 py-3 font-medium md:table-cell">Next action</th>
            </tr>
          </thead>
          <tbody className="bg-white">
            <tr className="border-b border-line">
              <td className="px-5 py-4">ML internship · remote</td>
              <td className="px-5 py-4">
                <StatusPill tone="sand">Review required</StatusPill>
              </td>
              <td className="hidden px-5 py-4 sm:table-cell">Tomorrow 23:59</td>
              <td className="hidden px-5 py-4 md:table-cell">Approve 1 answer</td>
            </tr>
            <tr className="border-b border-line">
              <td className="px-5 py-4">Research fellowship</td>
              <td className="px-5 py-4">
                <StatusPill tone="teal">Ready to apply</StatusPill>
              </td>
              <td className="hidden px-5 py-4 sm:table-cell">12 Sep</td>
              <td className="hidden px-5 py-4 md:table-cell">Autofill preview</td>
            </tr>
            <tr>
              <td className="px-5 py-4">Scholarship · STEM</td>
              <td className="px-5 py-4">
                <StatusPill tone="mint">Submitted</StatusPill>
              </td>
              <td className="hidden px-5 py-4 sm:table-cell">Snapshot stored</td>
              <td className="hidden px-5 py-4 md:table-cell">Track email</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
});
