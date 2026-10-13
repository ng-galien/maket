# Linux desktop installation

Maket App is the Electron desktop application, with its server and runtime
bundled. Node.js and the npm server are not required to use the installed app.
Current desktop snapshots target Linux **x64** and contain DEB and RPM packages.
Linux ARM64 is not a target of the snapshot workflow.

## Install an unpublished version

A version bump pushed to `main` does not publish npm or create a GitHub Release.
Open the [desktop snapshot workflow](https://github.com/ng-galien/maket/actions/workflows/desktop-snapshot.yml),
select the run for the exact commit, and download its `linux-x64` artifact after
the Linux job succeeds. Extract it and use the package for your distribution.
Do not assume the latest public release contains changes from that commit.

On Debian or Ubuntu, from the directory containing the extracted package:

```sh
sudo apt install ./Maket-Linux-x64.deb
```

On Fedora or another DNF-based distribution:

```sh
sudo dnf install ./Maket-Linux-x64.rpm
```

Launch Maket from the desktop menu, or use the packaged executable:

```sh
command -v Maket
Maket --enable-logging=stderr
```

If the command is not on PATH, locate it in the installed package instead of
guessing a path. On Debian/Ubuntu, the package name comes from the installer:

```sh
maket_package=$(dpkg-deb -f ./Maket-Linux-x64.deb Package)
dpkg -L "$maket_package" | grep -E '/(Maket|chrome-sandbox)$'
```

For RPM, replace the package query with
`rpm -ql "$(rpm -qp --queryformat '%{NAME}' ./Maket-Linux-x64.rpm)"`.
Run the application as your normal user, not with `sudo`.

## Diagnose a sandbox launch failure

Save the exact terminal error first. The Chromium process sandbox and the
Maket document lock are different mechanisms. Distributions may restrict
unprivileged user namespaces; Ubuntu can enforce this through AppArmor.
These commands inspect the current policy without changing it:

```sh
unshare -Ur true
sysctl kernel.unprivileged_userns_clone kernel.apparmor_restrict_unprivileged_userns
journalctl -k -b --no-pager | grep -Ei 'apparmor|userns|sandbox' | tail -30
```

Some sysctl keys do not exist on every distribution. A failed `unshare` is a
diagnostic clue, not proof that a specific AppArmor rule caused the failure.
If the error names `chrome-sandbox` and requires root ownership/mode 4755,
inspect that exact packaged helper with `ls -l` and verify/reinstall the trusted
package. Do not change permissions on an arbitrary helper from a writable
download directory. For an AppArmor denial, use the distribution's supported
per-application profile for the actual installed executable path; do not
disable AppArmor or user-namespace restrictions system-wide.

For a temporary diagnostic run only, Electron accepts:

```sh
Maket --no-sandbox --enable-logging=stderr
```

This disables Chromium's sandbox for all processes. It is not the normal
launcher and must not be added permanently to the desktop entry. Avoid opening
untrusted content during that diagnostic run. See the official
[Electron sandbox documentation](https://www.electronjs.org/docs/latest/tutorial/sandbox)
and [Ubuntu user-namespace explanation](https://ubuntu.com/blog/ubuntu-23-10-restricted-unprivileged-user-namespaces).

## Verification boundary

The snapshot job building a DEB/RPM is packaging evidence. It does not prove
that the application starts on your distribution or that its local sandbox
policy permits it. Check the installed version, opening a document, Reader
scrolling, an annotation saved and read back by the agent, and PDF export on
your Linux machine before treating that installation as validated.
