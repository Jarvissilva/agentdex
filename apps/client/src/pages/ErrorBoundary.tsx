import { isRouteErrorResponse, Link, useRouteError } from 'react-router';
import { Button } from '@/components/ui/shadcn/button';
import { ApiRequestError } from '@/lib/api';

export default function ErrorBoundary() {
  const error = useRouteError();
  const notFound = isRouteErrorResponse(error) && error.status === 404;

  return (
    <section role="alert" className="space-y-4 p-8">
      <h1 className="text-lg font-semibold">{notFound ? 'Page not found' : 'Unable to load this page'}</h1>
      <p className="text-sm text-muted-foreground">{notFound ? 'This page does not exist.' : error instanceof ApiRequestError ? error.message : 'Try reloading the page to continue.'}</p>
      <Button asChild variant="outline"><Link to="/sessions">Back to sessions</Link></Button>
    </section>
  );
}
