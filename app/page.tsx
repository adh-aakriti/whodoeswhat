import Link from "next/link";

export default function Home() {
  return (
    <main className="container hero">
      <p className="eyebrow">For university project teams</p>
      <h1>Group project tasks, with names and deadlines.</h1>
      <p className="lead">So when something isn&apos;t done, nobody has to guess whose it was.</p>
      <Link href="/signup" className="btn btn-primary btn-lg">
        Sign up
      </Link>

      <ul className="features">
        <li>
          <strong>Split the work</strong>
          <span>Turn the assignment into small tasks.</span>
        </li>
        <li>
          <strong>Put a name on it</strong>
          <span>Every task gets an owner and a deadline.</span>
        </li>
        <li>
          <strong>See what&apos;s next</strong>
          <span>Proposed, accepted, done — at a glance.</span>
        </li>
      </ul>
    </main>
  );
}
