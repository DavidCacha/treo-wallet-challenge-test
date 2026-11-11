import { EmptyState } from '../components/States';

export function Placeholder({ title }: { title: string }) {
  return (
    <section aria-labelledby="page-title">
      <h1 id="page-title">{title}</h1>
      <EmptyState title="Pantalla en construcción" />
    </section>
  );
}
