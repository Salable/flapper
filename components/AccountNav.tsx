/**
 * The account area's own sidebar - Profile and Licence today, room for more
 * as account settings grow (billing, connected apps as its own page, etc).
 * `current` is an explicit prop from the page rendering it, the same
 * pattern UserMenu's own `current` already uses, rather than detecting the
 * route client-side - every page here already knows which one it is.
 */
export function AccountNav({ current }: { current: 'profile' | 'licence' }) {
  const items: { id: typeof current; href: string; label: string }[] = [
    { id: 'profile', href: '/account', label: 'Profile' },
    { id: 'licence', href: '/account/licence', label: 'Licence' },
  ];
  return (
    <nav className="account-nav" aria-label="Account settings">
      {items.map((item) => (
        <a
          key={item.id}
          href={item.href}
          className={item.id === current ? 'is-selected' : ''}
          aria-current={item.id === current ? 'page' : undefined}
        >
          {item.label}
        </a>
      ))}
    </nav>
  );
}
