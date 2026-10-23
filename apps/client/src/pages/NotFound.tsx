import { Link } from 'react-router';
import { Button } from '@/components/ui/shadcn/button';

export default function NotFound() {
  return (
    <section className="space-y-4 p-8">
      <title>Page not found · Agentdex</title>
      <h1 className="text-lg font-semibold">Page not found</h1>
      <p className="text-sm text-muted-foreground">This page does not exist.</p>
      <Button asChild variant="outline"><Link to="/sessions">Back to sessions</Link></Button>
    </section>
  );
}
