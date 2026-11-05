import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Mail, Moon, ShieldCheck, Sun, Zap } from "lucide-react";

// Public page: it is NOT wrapped in ProtectedRoute and does not render the
// dashboard Navbar, so it opens for a visitor who is not signed in.
//
// The page only uses the design tokens from global.css / theme.css, so the
// light and dark palettes and the responsive card layout come from the same
// variables as the rest of the app.
//
// Every statement below matches what the code actually does. When a feature
// does not exist yet (for example a self-service "delete my account" button
// or per-user notification settings), the page says so instead of promising
// it.
const LAST_UPDATED = "5 November 2026";
const CONTACT_EMAIL = "doreply.volta@gmail.com";

const PrivacyPolicy = () => {
  // Same theme handling as the Navbar toggle: the choice is already applied
  // to <html data-theme> before first paint by the inline script in
  // index.html, so the page only flips it and persists the new value.
  const [theme, setTheme] = useState(() =>
    document.documentElement.getAttribute("data-theme") === "dark"
      ? "dark"
      : "light"
  );

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";

    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);

    try {
      localStorage.setItem("theme", next);
    } catch {
      // Storage unavailable (private mode): the theme still applies here
    }
  };

  const themeLabel =
    theme === "dark" ? "Switch to light mode" : "Switch to dark mode";

  return (
    <div className="policy-page">
      <header className="policy-topbar">
        <div className="policy-topbar-inner">
          <Link to="/" className="policy-brand">
            <span className="policy-brand-icon">
              <Zap size={18} />
            </span>
            <span className="policy-brand-name">VOLTA</span>
          </Link>

          <div className="policy-topbar-actions">
            <button
              type="button"
              className="theme-toggle"
              onClick={toggleTheme}
              aria-label={themeLabel}
              aria-pressed={theme === "dark"}
              title={themeLabel}
            >
              {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </button>

            <Link to="/login" className="policy-back">
              <ArrowLeft size={14} />
              <span>Back to sign in</span>
            </Link>
          </div>
        </div>
      </header>

      <main className="policy-main">
        <article className="policy-card">
          <div className="policy-heading">
            <span className="policy-eyebrow">
              <ShieldCheck size={14} />
              Legal
            </span>
            <h1>Privacy Policy</h1>
            <p className="policy-updated">Last updated: {LAST_UPDATED}</p>
          </div>

          <p>
            Volta is a task and team management app used inside a workplace.
            Managers create the accounts, assign tasks, schedule meetings and
            send notifications. There is no public sign-up. This page explains
            what Volta stores, why it stores it, how it is protected, and how it
            can be removed.
          </p>

          <section>
            <h2>1. Information Volta stores</h2>
            <p>Volta stores only what the features you use need:</p>
            <ul>
              <li>
                <strong>Employee and account details</strong> — your name, email
                address, role (manager or employee), department, designation,
                whether your account is active, and when the account was
                created or last updated.
              </li>
              <li>
                <strong>Your password</strong> — stored only as a one-way hash,
                never as readable text (see section 4).
              </li>
              <li>
                <strong>Task information</strong> — the title, description, the
                manager who created the task, the people it is assigned to, its
                priority, status, due date, and each assignee&apos;s own
                progress on it.
              </li>
              <li>
                <strong>Comments</strong> — the message you write, who wrote it,
                which task it belongs to, and when it was posted.
              </li>
              <li>
                <strong>Task history</strong> — a record of changes made to a
                task, such as when it was created, reassigned or its status
                changed.
              </li>
              <li>
                <strong>Meeting details</strong> — the title, date, time, agenda,
                an optional join link, the participants, the meeting status, and
                any summary or action items a manager publishes afterwards.
              </li>
              <li>
                <strong>Notifications</strong> — which user a notification is
                for, the task or meeting it refers to, its message, whether it
                has been read, and whether the email copy was delivered.
              </li>
            </ul>
            <p>
              In your browser, Volta keeps your sign-in token, a copy of the
              basic profile returned when you sign in (name, email, role,
              department, designation) and your light or dark theme choice in
              local storage. Volta does not use advertising or third-party
              tracking cookies.
            </p>
          </section>

          <section>
            <h2>2. How the information is used</h2>
            <ul>
              <li>To sign you in and keep you signed in until you log out.</li>
              <li>
                To show you the tasks, comments, meetings and notifications that
                belong to your account or your role.
              </li>
              <li>
                To let managers create and assign tasks, manage employee
                accounts and schedule meetings.
              </li>
              <li>
                To send in-app notifications, and an email copy of the
                important ones.
              </li>
              <li>
                To keep a history of task changes, so work can be tracked.
              </li>
            </ul>
            <p>
              Volta does not sell your information, and does not use it for
              advertising.
            </p>
          </section>

          <section>
            <h2>3. Passwords and how they are protected</h2>
            <p>
              Volta never stores your password as readable text. Passwords are
              hashed with <strong>bcrypt</strong>, a one-way function: a unique
              random salt is generated for each password and only the resulting
              hash (cost factor 10) is saved in the database. A hash cannot be
              turned back into the original password.
            </p>
            <p>
              When you sign in, the password you type is checked against the
              stored hash. The plain password is never written to the database
              or to the logs, and the password field is removed from every API
              response before it leaves the server.
            </p>
            <p>
              Managers set and reset passwords from the employee management
              page, and managers can change their own email and password in
              account settings. In the current version, employees cannot change
              their own password inside the app — ask your manager to reset it.
            </p>
          </section>

          <section>
            <h2>4. Email notifications, the Gmail API and OAuth 2.0</h2>
            <p>
              When a task is assigned, reassigned, commented on or completed,
              when its status changes, when a deadline is near or has passed, or
              when a meeting is created or updated, Volta can also send an email
              to the address saved on the account. The email is a copy of the
              notification that also appears inside the app.
            </p>
            <p>
              These emails are sent from a Volta mailbox through the{" "}
              <strong>Gmail API</strong>. Volta is authorised with{" "}
              <strong>OAuth 2.0</strong>: a long-lived refresh token issued by
              Google for that mailbox is exchanged for a short-lived access
              token when one is needed, and that access token is held in the
              server&apos;s memory only until it expires.
            </p>
            <p>
              Volta requests only the permission needed to send a message. It
              does not read, download, store or change anything else in the
              mailbox.
            </p>
            <p>
              The Google client ID, client secret, refresh token and access
              token stay on the server, in environment variables and process
              memory. They are never sent to the browser, never saved in the
              database, never printed in logs and never included in error
              messages. If the same deployment is configured with a different
              email service, that service delivers the same notification
              emails instead, and the Gmail API is not called.
            </p>
            <p>
              Email sending can be switched off for a deployment. When it is
              off, notifications still appear inside the app and no email is
              sent.
            </p>
          </section>

          <section>
            <h2>5. Who can see your information</h2>
            <p>
              Access inside Volta depends on your role, and the server checks it
              on every request:
            </p>
            <ul>
              <li>
                <strong>Managers</strong> can see employee accounts, all tasks,
                all meetings, and the notifications that belong to their own
                account.
              </li>
              <li>
                <strong>Employees</strong> can see the tasks assigned to them,
                their comments, the meetings they are a participant in, and
                their own notifications.
              </li>
            </ul>
            <p>
              Comments and task history are visible to the people who can open
              that task.
            </p>
            <p>
              Volta does not sell or rent personal information. It is shared
              only with the services that make the app work:
            </p>
            <ul>
              <li>
                <strong>Google</strong> — the Gmail API, used to send the
                notification emails described above.
              </li>
              <li>
                <strong>MongoDB Atlas</strong> — the database where accounts,
                tasks, comments, meetings and notifications are stored.
              </li>
              <li>
                <strong>Render</strong> and <strong>Vercel</strong> — the
                hosting services that run the backend and the frontend.
              </li>
            </ul>
            <p>
              Information is also disclosed where the law requires it, or where
              it is needed to protect the app and its users.
            </p>
          </section>

          <section>
            <h2>6. How your information is protected</h2>
            <ul>
              <li>Passwords are stored only as salted bcrypt hashes.</li>
              <li>
                Signing in returns a session token (JWT). Every request is
                re-checked on the server against the database, including the
                account&apos;s role and whether it is still active.
              </li>
              <li>
                Database credentials, the JWT secret and the Google OAuth
                credentials are kept in server-side environment variables, not
                in the code or the browser.
              </li>
              <li>
                The live site and its API are served over HTTPS, so traffic is
                encrypted in transit.
              </li>
              <li>
                Logging out removes the session token and the saved profile from
                your browser.
              </li>
            </ul>
            <p>
              No system can be perfectly secure, but these are the measures
              Volta actually uses today.
            </p>
          </section>

          <section>
            <h2>7. How long information is kept, and how it is deleted</h2>
            <p>
              Account details, tasks, comments, meetings and notifications are
              kept for as long as the account exists and the workspace needs
              them. Volta has no automatic deletion schedule.
            </p>
            <p>Accounts are managed by a manager:</p>
            <ul>
              <li>
                <strong>Deactivating</strong> an account blocks sign-in but
                keeps the record.
              </li>
              <li>
                <strong>Deleting</strong> an employee account removes the
                account, the comments and notifications written by that
                employee, and removes the person from meeting participant
                lists. Their tasks are not destroyed — they are handed to
                another assignee or back to the manager. Task history entries
                stay so the record of the work is not broken.
              </li>
              <li>
                Manager accounts cannot be deleted from inside the app.
              </li>
            </ul>
            <p>
              There is currently no self-service &quot;delete my account&quot;
              button. To have your account and personal information removed,
              ask your manager, or email{" "}
              <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> and we will
              handle the request in the workspace and reply to confirm what was
              removed. Information is kept longer only where the law requires
              it.
            </p>
            <p>
              On your own device, the saved session is deleted when you log out
              or when you clear your browser&apos;s site data.
            </p>
          </section>

          <section>
            <h2>8. Your choices</h2>
            <ul>
              <li>
                Managers can update account details, change their own email and
                password, and reset employee passwords.
              </li>
              <li>
                You can ask what information is stored about you, ask for a
                correction, or ask for it to be deleted, by emailing us.
              </li>
              <li>
                Volta does not currently have per-user settings to turn email
                notifications off. If you need them stopped, contact your
                manager or email us.
              </li>
            </ul>
          </section>

          <section>
            <h2>9. Children</h2>
            <p>
              Volta is a tool for workplaces and is not intended for use by
              children. Accounts are created by a manager for work purposes
              only.
            </p>
          </section>

          <section>
            <h2>10. Changes to this policy</h2>
            <p>
              If this policy changes, the date at the top of this page is
              updated. The page always describes the version of Volta that is
              running at the time.
            </p>
          </section>

          <section>
            <h2>11. Contact</h2>
            <p>
              If you have a question about this policy, or about the information
              stored about you, email us at{" "}
              <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
            </p>
            <div className="policy-contact">
              <Mail size={18} />
              <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
            </div>
          </section>
        </article>
      </main>

      <footer className="policy-footer">
        <span>© 2026 Volta</span>
        <span className="policy-footer-sep">·</span>
        <Link to="/terms-of-service">Terms of Service</Link>
        <span className="policy-footer-sep">·</span>
        <Link to="/login">Sign in</Link>
      </footer>
    </div>
  );
};

export default PrivacyPolicy;
