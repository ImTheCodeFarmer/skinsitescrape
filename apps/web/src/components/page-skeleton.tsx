import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/** Placeholder in the dashboard's shape: header, KPI row, chart beside a side card, then a table. Shown while a page's queries run. */
export function PageSkeleton({ hero = false }: { hero?: boolean }) {
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5" aria-busy="true" aria-label="Loading">
      {hero ? (
        <Card>
          <CardContent className="flex items-center gap-5 py-2">
            <Skeleton className="size-16 rounded-xl" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-7 w-48" />
              <Skeleton className="h-4 w-72 max-w-full" />
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Card key={i} className="gap-2 px-5 py-4">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-7 w-28" />
          </Card>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader><Skeleton className="h-5 w-32" /></CardHeader>
          <CardContent><Skeleton className="h-64 w-full" /></CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader><Skeleton className="h-5 w-32" /></CardHeader>
          <CardContent className="flex flex-col gap-3">
            {Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-8 w-full" />)}
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader><Skeleton className="h-5 w-40" /></CardHeader>
        <CardContent className="flex flex-col gap-2">
          {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-9 w-full" />)}
        </CardContent>
      </Card>
    </div>
  );
}
