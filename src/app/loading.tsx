import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";

export default function HomeLoading() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-10 w-28" />
      </div>
      <Card>
        <ul className="divide-y divide-[hsl(var(--border))]">
          {Array.from({ length: 3 }).map((_, i) => (
            <li key={i} className="flex items-center justify-between p-4">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-4 w-32" />
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
