import type { Metadata } from "next";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { SettingsForm } from "./settings-form";
import { DiscoverProfilesSection } from "./discover-profiles-section";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <div className="space-y-4">
      <Breadcrumbs items={[{ label: "Trips", href: "/" }, { label: "Settings" }]} />
      <h1 className="text-2xl font-semibold">Settings</h1>
      <SettingsForm />
      <DiscoverProfilesSection />
    </div>
  );
}
