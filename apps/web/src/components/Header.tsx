import Link from "next/link";

export function Header() {
  return (
    <header>
      <h1>
        <Link href="/">Foresight</Link>
      </h1>
      <nav>
        <Link href="/create">Create</Link>
      </nav>
    </header>
  );
}
