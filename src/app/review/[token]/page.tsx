import { Download, FileText } from "lucide-react";
import { formatPropertyName } from "@/lib/propertyName";
import { validateReviewToken } from "@/lib/reviewToken";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { Card, ReviewShell } from "@/app/review/ui";
import { ReviewEditor, type ReviewItem } from "./review-editor";

function formatDateAU(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${Number(d)}/${m}/${y}`;
}

export default async function ReviewPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const scope = await validateReviewToken(token);

  if (!scope) {
    return (
      <ReviewShell title="This link has expired">
        <Card>
          <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            Ask the inspector to resend the review link.
          </p>
        </Card>
      </ReviewShell>
    );
  }

  const sb = supabaseAdmin();

  const { data: inspection } = await sb
    .from("inspections")
    .select("property_name, inspection_date")
    .eq("id", scope.inspectionId)
    .single();

  const { data: items } = await sb
    .from("action_items")
    .select("id, area, comment, original_comment, ai_comment, sort_order")
    .eq("inspection_id", scope.inspectionId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  const itemIds = (items ?? []).map((item) => item.id);
  const { data: photos } =
    itemIds.length > 0
      ? await sb
          .from("photos")
          .select("id, action_item_id, filename, taken_at")
          .in("action_item_id", itemIds)
          .order("taken_at", { ascending: true })
      : { data: [] };

  const photosByItem = new Map<string, { id: string; filename: string }[]>();
  for (const photo of photos ?? []) {
    const arr = photosByItem.get(photo.action_item_id) ?? [];
    arr.push({ id: photo.id, filename: photo.filename });
    photosByItem.set(photo.action_item_id, arr);
  }

  const reviewItems: ReviewItem[] = (items ?? []).map((item) => ({
    id: item.id,
    area: item.area,
    comment: item.comment ?? "",
    original_comment: item.original_comment,
    ai_comment: item.ai_comment,
    photos: photosByItem.get(item.id) ?? [],
  }));

  return (
    <ReviewShell
      title={
        inspection ? formatPropertyName(inspection.property_name) : "Inspection review"
      }
      subtitle={
        inspection
          ? `Council routine inspection · ${formatDateAU(inspection.inspection_date)}`
          : undefined
      }
      actions={
        <>
          <a
            href={`/review/${token}/download`}
            download
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-black/[.12] bg-white px-4 text-sm font-semibold text-zinc-700 transition-colors hover:bg-black/[.04] dark:border-white/[.18] dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-white/[.08]"
          >
            <FileText className="h-4 w-4" aria-hidden="true" />
            Download Word document
          </a>
          <a
            href={`/review/${token}/download?format=pdf`}
            download
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#0072c6] px-4 text-sm font-semibold text-white shadow-sm shadow-[#0072c6]/20 transition-colors hover:bg-[#005ea2]"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            Download as PDF
          </a>
        </>
      }
    >
      {reviewItems.length === 0 ? (
        <Card>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            No action items on this inspection yet.
          </p>
        </Card>
      ) : (
        <ReviewEditor token={token} items={reviewItems} />
      )}
    </ReviewShell>
  );
}
