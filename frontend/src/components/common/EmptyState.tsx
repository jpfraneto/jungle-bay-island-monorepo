export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="card text-center">
      <p className="font-display text-lg text-zinc-100">{title}</p>
      <p className="mt-2 text-sm text-zinc-400">{description}</p>
    </div>
  );
}
