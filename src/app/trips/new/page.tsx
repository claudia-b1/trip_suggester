import type { Metadata } from "next";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { NewTripForm } from "./new-trip-form";

export const metadata: Metadata = { title: "New trip" };

export default function NewTripPage() {
  return (
    <div className="space-y-4">
      <Breadcrumbs items={[{ label: "Trips", href: "/" }, { label: "New trip" }]} />
      <h1 className="text-2xl font-semibold">New trip</h1>
      <NewTripForm />
    </div>
  );
}
