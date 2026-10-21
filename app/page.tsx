import Link from "next/link";
import { ListChecksIcon, StatusIcon } from "@/components/Icons";
import Avatar from "@/components/Avatar";
import Tagline from "@/components/Tagline";

const EXAMPLE = [
  { title: "Write literature review", owner: "Marta", due: "14 Nov", status: "proposed", note: "Proposed to Marta · waiting to accept" },
  { title: "Run the customer survey", owner: "Jonas", due: "18 Nov", status: "accepted", note: "Accepted by Jonas" },
  { title: "Build financial model", owner: "Aisha", due: "21 Nov", status: "accepted", note: "Accepted by Aisha" },
  { title: "Book room for final rehearsal", owner: "Leo", due: "9 Nov", status: "done", note: "Done by Leo" },
] as const;

export default function Home() {
  return (
    <main className="container landing">
      <Tagline />
      <section className="landing-intro">
        <p className="eyebrow">For university project teams</p>
        <h1 className="display">Group project tasks, with names and deadlines.</h1>
        <p className="lead">
          Your group shares one task list. Every task goes to one named person, who accepts it, so everyone
          knows who is doing what.
        </p>
        <div className="cta">
          <Link href="/signup" className="btn btn-primary">
            Sign up
          </Link>
          <span className="muted">
            Already have an account? <Link href="/login" className="text-link">Log in</Link>
          </span>
        </div>
      </section>

      <figure className="landing-sheet">
        <figcaption className="sheet-caption">
          <span>Marketing 301 · Final project · shared by 4 people</span>
          <span className="muted">Example</span>
        </figcaption>
        <div className="sheet-head" aria-hidden="true">
          <span>Task</span>
          <span>Owner</span>
          <span>Due</span>
          <span>Status</span>
        </div>
        <ul className="sheet">
          {EXAMPLE.map((t) => (
            <li key={t.title} className={`sheet-row status-${t.status}`}>
              <span className="cell-title">
                {t.title}
                <span className="state-note">{t.note}</span>
              </span>
              <span className="cell-owner"><span className="cell-label">Owner </span><Avatar name={t.owner} />{t.owner}</span>
              <span className="cell-due"><span className="cell-label">Due </span>{t.due}</span>
              <span className="cell-status"><StatusIcon status={t.status} />{t.status}</span>
            </li>
          ))}
        </ul>
      </figure>

      <p className="how">
        <ListChecksIcon size={20} className="how-icon" />
        <strong>How it works.</strong> One person starts a project and shares its join code with the group.
        Everyone sees the same tasks. Each task gets an owner by name and a deadline, and the owner accepts it
        or says no. Anyone can pick up a task nobody owns yet.
      </p>
    </main>
  );
}
