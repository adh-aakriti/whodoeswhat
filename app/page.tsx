import Link from "next/link";
import { ListChecksIcon, StatusIcon } from "@/components/Icons";
import Avatar from "@/components/Avatar";
import Tagline from "@/components/Tagline";

const EXAMPLE = [
  { title: "Write literature review", owner: "Marta", due: "14 Nov", status: "accepted" },
  { title: "Run the customer survey", owner: "Jonas", due: "18 Nov", status: "proposed" },
  { title: "Build financial model", owner: "Aisha", due: "21 Nov", status: "accepted" },
  { title: "Book room for final rehearsal", owner: "Leo", due: "9 Nov", status: "done" },
] as const;

export default function Home() {
  return (
    <main className="container landing">
      <Tagline />
      <section className="landing-intro">
        <p className="eyebrow">For university project teams</p>
        <h1 className="display">Group project tasks, with names and deadlines.</h1>
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
          <span>Marketing 301 · Final project</span>
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
              <span className="cell-title">{t.title}</span>
              <span className="cell-owner"><span className="cell-label">Owner </span><Avatar name={t.owner} />{t.owner}</span>
              <span className="cell-due"><span className="cell-label">Due </span>{t.due}</span>
              <span className="cell-status"><StatusIcon status={t.status} />{t.status}</span>
            </li>
          ))}
        </ul>
      </figure>

      <p className="how">
        <ListChecksIcon size={20} className="how-icon" />
        <strong>How it works.</strong> Write each task down, put one name and a date next to it, and
        move it from proposed to accepted to done as the work happens.
      </p>
    </main>
  );
}
