import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Mail, Moon, Scale, Sun, Zap } from "lucide-react";

// Public page: NOT wrapped in ProtectedRoute and without the dashboard
// Navbar, so a signed-out visitor can open it directly.
//
// It reuses the legal page shell (.policy-page, .policy-topbar,
// .policy-card, .policy-footer) defined in PrivacyPolicy.css, so the two
// legal pages share one layout, one type scale and both themes.
//
// Everything below describes behaviour that exists in this codebase. Where
// a feature or policy is deliberately absent (self-service account
// deletion, guaranteed uptime, notification preferences), the page says so
// rather than promising it.
const LAST_UPDATED = "5 November 2026";
const CONTACT_EMAIL = "doreply.volta@gmail.com";

const TermsOfService = () => {
  // Same theme handling as the Navbar and the Privacy Policy page: the
  // saved choice is already on <html data-theme> before first paint (inline
  // script in index.html), so this only flips and persists it.
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
              <Scale size={14} />
              Legal
            </span>
            <h1>Terms of Service</h1>
            <p className="policy-updated">Last updated: {LAST_UPDATED}</p>
            <p className="legal-crosslink">
              See also: <Link to="/privacy-policy">Privacy Policy</Link>
            </p>
          </div>

          <p>
            These terms explain the rules for using Volta. They are written in
            simple language on purpose. Please read them before you use the
            app.
          </p>

          <section>
            <h2>1. Acceptance of these terms</h2>
            <p>
              By signing in and using Volta, you agree to these terms. If you do
              not agree with them, please do not use Volta — ask your manager to
              close your account.
            </p>
            <p>
              These terms apply to everyone who signs in, whether as a manager
              or as an employee. Read them together with our{" "}
              <Link to="/privacy-policy">Privacy Policy</Link>, which explains
              what information Volta stores and how it is protected.
            </p>
          </section>

          <section>
            <h2>2. About Volta and its purpose</h2>
            <p>
              Volta is an internal task and team management platform for
              workplaces. Managers create the accounts, so there is no public
              sign-up and Volta is not offered to the general public.
            </p>
            <p>
              Volta keeps daily work in one place: employee accounts, task
              assignment and progress, comments, meetings and notifications. It
              is a tool that helps a team stay organised. It does not replace
              the judgement, approvals or responsibilities of a manager or an
              employer.
            </p>
          </section>

          <section>
            <h2>3. User accounts and login credentials</h2>
            <ul>
              <li>
                Accounts are created by a manager. Volta allows one account per
                email address.
              </li>
              <li>
                You sign in with the email address and password saved on your
                account.
              </li>
              <li>
                Managers can set and reset an employee&apos;s password from
                employee management, and can change their own email and
                password in account settings. In the current version, employees
                cannot change their own password inside the app.
              </li>
              <li>
                A manager can deactivate an account. A deactivated account can
                no longer sign in, but its records stay in the system.
              </li>
              <li>
                Your account is for you alone. Do not share your login details
                or let someone else use your account.
              </li>
            </ul>
          </section>

          <section>
            <h2>4. Manager and employee roles and permissions</h2>
            <p>
              What you can see and do in Volta depends on your role. The server
              checks your role and your account state on every request, so these
              limits are enforced by the application and not only by what the
              screens show.
            </p>
            <p>
              <strong>Managers</strong> can view employee accounts, view all
              tasks and meetings, create, edit, assign, reassign and delete
              tasks, create and update meetings, and manage employee accounts
              (create, edit, reset password, activate, deactivate and delete
              employee accounts).
            </p>
            <p>
              <strong>Employees</strong> can see the tasks assigned to them,
              update their own task status, add comments to tasks they can open,
              view the meetings they are a participant in, and see their own
              notifications.
            </p>
          </section>

          <section>
            <h2>5. Responsibilities of managers</h2>
            <ul>
              <li>
                Create accounts only for real team members, and enter their
                details correctly.
              </li>
              <li>
                Keep employee information accurate and up to date, and correct
                it when it changes.
              </li>
              <li>
                Treat employee information as confidential and look only at what
                your work requires.
              </li>
              <li>
                Assign work and deadlines fairly, and keep task details clear
                enough for the employee to act on.
              </li>
              <li>
                Be careful with destructive actions. Deleting an employee
                account removes that employee&apos;s comments and notifications
                and reassigns their tasks — read section 13 before you do it.
              </li>
              <li>
                Do not create shared or generic accounts, and do not let anyone
                else sign in with your account.
              </li>
              <li>
                Use Volta in line with the rules of your workplace and the law
                that applies to you.
              </li>
            </ul>
          </section>

          <section>
            <h2>6. Responsibilities of employees</h2>
            <ul>
              <li>
                Use only your own account, and keep your password to yourself.
              </li>
              <li>
                Keep your task status up to date and mark work honestly —
                managers rely on it to plan.
              </li>
              <li>
                Write comments that are professional, relevant and civil. Do not
                post offensive, harassing or unlawful content.
              </li>
              <li>
                Report problems with your access to your manager instead of
                trying to work around them.
              </li>
              <li>
                Do not try to open tasks, accounts or meetings that belong to
                someone else.
              </li>
            </ul>
          </section>

          <section>
            <h2>7. Tasks, assignments, updates, comments and deadlines</h2>
            <ul>
              <li>
                A task holds a title, description, priority, due date, one or
                more assignees, and a status.
              </li>
              <li>
                When a task has several assignees, each person has their own
                status: <strong>Pending</strong>, <strong>In Progress</strong>,{" "}
                <strong>Completed</strong> or <strong>On Hold</strong>.
                Completing your own part does not change anyone else&apos;s.
              </li>
              <li>
                Managers can edit, reassign and delete tasks. Volta keeps a
                record of changes made to a task, so there is a history of the
                work.
              </li>
              <li>
                Comments on a task are visible to the people who can open that
                task.
              </li>
              <li>
                Due dates are organisational reminders. Volta shows work as
                upcoming or overdue, but it does not apply penalties, and it does
                not check whether the work itself was done well.
              </li>
            </ul>
          </section>

          <section>
            <h2>8. Meetings, notifications and email</h2>
            <ul>
              <li>
                Managers can create, update and cancel meetings with a title,
                date, time, agenda, participants and an optional join link, and
                can publish a summary and action items afterwards.
              </li>
              <li>
                Employees can view the meetings they are a participant in.
              </li>
              <li>
                A join link may point to a third-party service such as Google
                Meet, Zoom or Microsoft Teams. Those services have their own
                terms, and Volta does not control them.
              </li>
              <li>
                Volta shows in-app notifications for task and meeting activity,
                and can also send an email copy of the important ones to the
                address saved on your account.
              </li>
              <li>
                Email delivery depends on the mail provider configured for the
                deployment and can be switched off. Even when it is on, an email
                can be delayed, filtered or fail.
              </li>
              <li>
                Notifications are a convenience. Do not treat them as the only
                record of your work, and do not rely on them as an official
                channel for notices.
              </li>
            </ul>
          </section>

          <section>
            <h2>9. Account security and password responsibilities</h2>
            <ul>
              <li>
                Passwords are stored only as salted bcrypt hashes, so nobody can
                read your password back — not even a manager. If it is
                forgotten, it can only be reset.
              </li>
              <li>
                Keep your password private, use one you do not reuse elsewhere,
                and log out when you finish on a shared or public computer.
              </li>
              <li>
                Volta keeps the sign-in session in your browser on the device
                you signed in from. Only sign in on devices you trust.
              </li>
              <li>
                Volta will never ask for your password by email. If you receive
                such a request, do not answer it and tell your manager.
              </li>
              <li>
                If you think someone else has used your account, tell your
                manager straight away so the password can be reset.
              </li>
            </ul>
          </section>

          <section>
            <h2>10. Acceptable use of the platform</h2>
            <p>When using Volta, you must not:</p>
            <ul>
              <li>use it for anything unlawful or against workplace policy;</li>
              <li>
                try to open accounts, tasks, meetings or notifications you are
                not permitted to see, or bypass the sign-in step;
              </li>
              <li>
                probe, scan, break, overload or disrupt the app, its server or
                its database;
              </li>
              <li>
                enter malicious code, or upload anything designed to damage the
                service or other users;
              </li>
              <li>
                use comments or task text to harass, threaten, discriminate or
                abuse another person;
              </li>
              <li>
                impersonate another person, or copy other people&apos;s data out
                of the app for unrelated purposes.
              </li>
            </ul>
            <p>
              Access that breaks these rules can be suspended or removed by a
              manager.
            </p>
          </section>

          <section>
            <h2>11. Data accuracy and user responsibility</h2>
            <ul>
              <li>
                Volta stores and displays the information that people enter. It
                does not check it, verify it or correct it automatically.
              </li>
              <li>
                Managers are responsible for the accuracy of employee records,
                tasks and meetings they create or edit.
              </li>
              <li>
                Employees are responsible for the accuracy of their status
                updates and comments.
              </li>
              <li>
                Check the details before you rely on them for a decision about
                work or people.
              </li>
            </ul>
          </section>

          <section>
            <h2>12. Service availability and maintenance</h2>
            <ul>
              <li>
                Volta is provided for internal workplace use and is offered as
                it is.
              </li>
              <li>
                The app may be unavailable during maintenance, updates, or an
                outage of a service it depends on — including its hosting, its
                database or its email provider.
              </li>
              <li>
                There is no guaranteed uptime and no service-level commitment
                for Volta.
              </li>
              <li>
                Features may change, or be added or removed, as the project
                develops. Where a change affects your information, the{" "}
                <Link to="/privacy-policy">Privacy Policy</Link> is updated with
                it.
              </li>
            </ul>
          </section>

          <section>
            <h2>13. Account suspension and deletion</h2>
            <ul>
              <li>
                A manager can deactivate an account, which blocks sign-in while
                keeping its records, or delete an employee account.
              </li>
              <li>
                Deleting an employee account removes the account, the comments
                and notifications written by that employee, and removes the
                person from meeting participant lists. Their tasks are not
                destroyed — they are handed to another assignee or back to the
                manager. Task history entries are kept so the record of the work
                stays intact.
              </li>
              <li>
                Manager accounts cannot be deleted from inside the app, and
                nobody can delete their own account.
              </li>
              <li>
                There is no self-service &quot;delete my account&quot; button.
                Ask your manager, or email{" "}
                <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>, and we
                will handle the request and reply to confirm what was done.
              </li>
              <li>
                Volta has no automatic deletion schedule, and no fixed number of
                days is promised for finishing a deletion request.
              </li>
            </ul>
          </section>

          <section>
            <h2>14. Changes to these terms</h2>
            <p>
              These terms may be updated when the app changes. The new version
              is published on this page with a new date at the top, and
              continuing to use Volta after that means you accept the updated
              terms.
            </p>
            <p>
              These terms do not remove any right you have under the law that
              applies to you.
            </p>
          </section>

          <section>
            <h2>15. Contact</h2>
            <p>
              If you have a question about these terms or about how Volta
              should be used, email us at{" "}
              <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. For
              questions about your information, see the{" "}
              <Link to="/privacy-policy">Privacy Policy</Link>.
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
        <Link to="/privacy-policy">Privacy Policy</Link>
        <span className="policy-footer-sep">·</span>
        <Link to="/login">Sign in</Link>
      </footer>
    </div>
  );
};

export default TermsOfService;
