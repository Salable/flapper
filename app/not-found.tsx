import { LinkButton } from '@/components/ui/Button';

export default function NotFound() {
  return (
    <main className="landing">
      <h1>FLAPPER</h1>
      <p>Nothing at this address.</p>
      <p className="muted">
        Boards live at /b/&#123;slug&#125; — and slugs can be renamed, so a link that worked
        yesterday may have moved.
      </p>
      <div className="actions">
        <LinkButton variant="primary" href="/dashboard">
          Your dashboard
        </LinkButton>
        <LinkButton href="/docs">Docs</LinkButton>
      </div>
    </main>
  );
}
