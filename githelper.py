#!/usr/bin/env python3
import os
import subprocess
import sys

# Colors for terminal
GREEN = "\033[92m"
YELLOW = "\033[93m"
RED = "\033[91m"
CYAN = "\033[96m"
BOLD = "\033[1m"
RESET = "\033[0m"

def run(cmd, capture=False):
    if capture:
        result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
        return result.stdout.strip(), result.stderr.strip()
    else:
        return subprocess.run(cmd, shell=True)

def banner():
    print(f"""
{CYAN}{BOLD}╔══════════════════════════════╗
║      🚀 Git Smart Helper     ║
╚══════════════════════════════╝{RESET}
""")

def check_git_repo():
    # Fix dubious ownership first
    cwd = os.getcwd()
    run(f'git config --global --add safe.directory "{cwd}"')
    
    out, err = run("git status", capture=True)
    if "not a git repository" in err:
        return False
    return True

def get_remote_url():
    url, _ = run("git remote get-url origin", capture=True)
    return url or "No remote set"

def get_branch():
    branch, _ = run("git branch --show-current", capture=True)
    return branch or "main"

def init_repo():
    print(f"\n{YELLOW}⚠️  Yeh folder git repo nahi hai.{RESET}")
    choice = input("Kya naya git repo initialize karna hai? (y/n): ").strip().lower()
    if choice != 'y':
        print(f"{RED}Cancelled.{RESET}")
        sys.exit(0)

    remote = input("GitHub repo URL dalo (blank agar baad mein add karna ho): ").strip()
    run("git init")
    if remote:
        run(f"git remote add origin {remote}")
    print(f"{GREEN}✅ Git repo initialized!{RESET}")

def do_pull(branch):
    print(f"\n{CYAN}📥 Pulling from origin/{branch}...{RESET}\n")
    result = run(f"git pull origin {branch}")
    if result.returncode == 0:
        print(f"\n{GREEN}✅ Pull successful!{RESET}")
    else:
        print(f"\n{RED}❌ Pull failed. Upar error dekho.{RESET}")

def do_push(branch):
    # Show changed files
    changed, _ = run("git status --short", capture=True)
    if not changed:
        print(f"\n{YELLOW}⚠️  Koi changes nahi hain push karne ke liye.{RESET}")
        return

    print(f"\n{YELLOW}📝 Changed files:{RESET}")
    print(changed)

    msg = input(f"\n{CYAN}Commit message likho (kya changes kiye):{RESET}\n> ").strip()
    if not msg:
        msg = "Update"

    print(f"\n{CYAN}📤 Pushing to origin/{branch}...{RESET}\n")
    run("git add .")
    run(f'git commit -m "{msg}"')
    result = run(f"git push origin {branch}")

    if result.returncode == 0:
        print(f"\n{GREEN}✅ Push successful!{RESET}")
    else:
        print(f"\n{RED}❌ Push failed.{RESET}")
        print(f"{YELLOW}💡 Tip: GitHub password ki jagah Personal Access Token use karo.{RESET}")
        print(f"    GitHub → Settings → Developer Settings → Personal Access Tokens\n")

def main():
    banner()

    # Check if git repo
    if not check_git_repo():
        init_repo()

    cwd = os.getcwd()
    branch = get_branch()
    remote = get_remote_url()

    print(f"{BOLD}📁 Folder  :{RESET} {cwd}")
    print(f"{BOLD}🌿 Branch  :{RESET} {branch}")
    print(f"{BOLD}🔗 Remote  :{RESET} {remote}")

    print(f"""
{BOLD}Kya karna hai?{RESET}
  {GREEN}1{RESET} → 📥 Pull  (GitHub se latest code lena)
  {YELLOW}2{RESET} → 📤 Push  (apna code GitHub pe dalna)
  {RED}3{RESET} → ❌ Exit
""")

    choice = input("Choose (1/2/3): ").strip()

    if choice == "1":
        do_pull(branch)
    elif choice == "2":
        do_push(branch)
    elif choice == "3":
        print(f"{RED}Bye! 👋{RESET}")
        sys.exit(0)
    else:
        print(f"{RED}Invalid choice!{RESET}")

if __name__ == "__main__":
    main()
