export default function Home() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-3xl font-bold tracking-tight">SimOrg Middleware</h1>
      <p className="mt-3 text-slate-600 dark:text-slate-400">
        An access-controlled API gateway in front of the SimOrg ERP. It mirrors
        the SimOrg API and adds a single control: an <code>instance</code>{" "}
        selector (<code>FR</code>, <code>SA</code>, or <code>ALL</code>).
      </p>

      <section className="mt-10">
        <h2 className="text-lg font-semibold">Calling the API</h2>
        <pre className="mt-3 overflow-x-auto rounded-lg bg-slate-900 p-4 text-sm text-slate-100">
          {`curl https://<host>/api/simorg/<simorg-path>?instance=FR \\
  -H "Authorization: Bearer smk_xxx"`}
        </pre>
        <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-slate-600 dark:text-slate-400">
          <li>Authenticate with an issued API key (read-only by default).</li>
          <li>
            Choose the instance via <code>?instance=</code> or the{" "}
            <code>x-simorg-instance</code> header.
          </li>
          <li>
            <code>instance=ALL</code> merges both databases; each record is
            tagged with <code>_instance</code> to resolve id collisions.
          </li>
        </ul>
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-semibold">Coming next</h2>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
          Microsoft SSO sign-in, a self-service page for 3-month read-only
          tokens, and an admin console to manage scopes and block keys.
        </p>
      </section>
    </main>
  );
}
