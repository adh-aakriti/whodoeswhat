// "3 tasks" with the number set large and bold; reads exactly the same as plain text.
export default function TaskCount({ n }: { n: number }) {
  if (n === 0) return <>no tasks</>;
  return (
    <>
      <strong className="count-num">{n}</strong> {n === 1 ? "task" : "tasks"}
    </>
  );
}
