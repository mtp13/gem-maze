# Gem Maze

Collect every gem to unlock the exit, dodge the beetles and escape fast for
three stars. Made for ages 7 to 11.

**[Play it → mike.pullen.dev/gem-maze/](https://mike.pullen.dev/gem-maze/)**

## How to play

Arrow keys or WASD (hold to keep moving). On touch screens, swipe to slide down
a hallway or use the arrow pad. P or Esc pauses.

## Development

There's no build step. Serve the folder over HTTP:

```sh
python3 -m http.server 4321
```

Then open <http://localhost:4321/>.

| Command          | What it does                                   |
| ---------------- | ---------------------------------------------- |
| `npm ci`         | Install the dev tooling (once)                 |
| `npm test`       | Run the tests with Node's built-in test runner |
| `npm run lint`   | Check formatting (Prettier) and HTML validity  |
| `npm run format` | Format the code with Prettier                  |

## Tech

Plain HTML, CSS and JavaScript with no framework, no runtime dependencies and no
build step. Deployed to [Vercel](https://vercel.com) with a strict
Content-Security-Policy in `vercel.json`, and served on
[mike.pullen.dev](https://mike.pullen.dev) through that site's proxy rewrites.
Roboto Mono is self-hosted in `fonts/` (SIL OFL 1.1, see `fonts/OFL.txt`).
