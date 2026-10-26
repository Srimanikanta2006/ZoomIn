import { ReviewWorkspace } from "@/components/review-workspace";

export default async function CaseFilePage({ params }: { params: Promise<{ application_id: string }> }) {
  const { application_id: applicationId } = await params;
  return <ReviewWorkspace screen="case_file" applicationId={applicationId} />;
}
