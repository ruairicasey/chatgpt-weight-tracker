export default function Home() {
  return (
    <main>
      <nav aria-label="Brand"><span className="mark" aria-hidden="true">w.</span> Weight Tracker</nav>
      <section aria-labelledby="welcome-title">
        <p className="eyebrow">A little more intention, every day.</p>
        <h1 id="welcome-title">Your progress.<br /><span>Your own pace.</span></h1>
        <p className="intro">A personal space for food, movement and the habits that add up.</p>
        <p className="notice" role="status">Your private tracker is taking shape. Logging and sign-in are not available yet.</p>
      </section>
      <footer>Small steps. A longer view.</footer>
    </main>
  );
}
