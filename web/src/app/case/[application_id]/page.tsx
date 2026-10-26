import { ReviewWorkspace } from "@/components/review-workspace";

export function generateStaticParams() {
  return [
    { application_id: "20000000-0000-4000-8000-000000000001" },
    { application_id: "20000000-0000-4000-8000-000000000002" },
    { application_id: "20000000-0000-4000-8000-000000000003" },
    { application_id: "20000000-0000-4000-8000-000000000004" },
    { application_id: "20000000-0000-4000-8000-000000000005" },
    { application_id: "default" },
  ];
}

export default async function CaseFilePage({ params }: { params: Promise<{ application_id: string }> }) {
  const { application_id: applicationId } = await params;
  return <ReviewWorkspace screen="case_file" applicationId={applicationId} />;
}
