# About

_Ms. Pac-Man 2010_ is an expanded and graphically enhanced version of the original _Ms. Pac-Man_ arcade game. Instead of cycling endlessly through the same boards, the game is divided into four worlds, each featuring eight unique mazes.

Press the **Play** button below to launch the desktop browser version of _Ms. Pac-Man 2010_.

[Play](__PWA_URL__)

# Controls

_Ms. Pac-Man 2010_ supports both keyboard and gamepad input. The controls are:

| Action | Keyboard                       | Gamepad     |
| ------ | ------------------------------ | ----------- |
| Up     | Up Arrow, W, I, 8, Numpad 8    | D-pad Up    |
| Down   | Down Arrow, S, K, 2, Numpad 2  | D-pad Down  |
| Left   | Left Arrow, A, J, 4, Numpad 4  | D-pad Left  |
| Right  | Right Arrow, D, L, 6, Numpad 6 | D-pad Right |
| Start  | Enter                          | Any         |
| Pause  | Enter, P                       | Any         |

## Browser Menu

_Ms. Pac-Man 2010_ opens with a browser menu that provides **New Game** and **Continue** buttons.

**New Game** starts a new game. **Continue** resumes your previous game. _Ms. Pac-Man 2010_ saves your progress so you can close the tab—or even close the browser entirely—and return later to continue playing.

While playing outside fullscreen mode, a hamburger button appears in the upper-left corner of the game. Pressing it pauses the game and returns you to the browser menu.

The browser menu also provides:

- **Fullscreen** — Makes the game fill the entire screen.
- **Scaling** — Controls how the game is resized to fit the display.
- **Volume** — Adjusts the game volume.
- **Reset** — Erases saved state and restores settings to their defaults.

# History

I created _Ms. Pac-Man 2010_ in 2010—hence the name—as a Java game using the [Slick2D](https://github.com/nguillaumin/slick2d-maven) and [JInput](https://jinput.github.io/jinput/) libraries. I studied the original arcade game in the [MAME](https://www.mamedev.org/) multi-purpose emulator and recreated its mazes and mechanics through observation.

I released _Ms. Pac-Man 2010_ as a Java applet that ran in a web page and as a downloadable desktop version. As technology evolved, both options became increasingly impractical. Browsers abandoned Java applets, while the desktop version required players to download and run an executable and install Java, something many people understandably avoided because of the hassle and security concerns. The game also relied on platform-specific native libraries that became increasingly difficult to run reliably on modern systems.

In 2026, I rewrote _Ms. Pac-Man 2010_ in TypeScript and adapted it to modern web browsers. The new version once again lets visitors launch the game directly from a web page and adds a few modern features, including save-state support. The game itself remains fundamentally the _Ms. Pac-Man 2010_ I created in 2010.

# Differences

_Ms. Pac-Man 2010_ is based on the original arcade game but expands on it in several ways.

A cutscene appears between every stage. The first three recreate the intermissions from the original _Ms. Pac-Man_ arcade game. The later cutscenes were based on the between-fight scenes in _Mike Tyson's Punch-Out!!_ for the Nintendo Entertainment System.

After completing Stage 8, the player is rewarded with a final sequence inspired by Ryu's ending in the arcade version of _Street Fighter II_.

The game employs two special energizers from _Pac-Mania_: the red energizer sends the ghosts into their familiar blue frightened state, while the green energizer temporarily gives Ms. Pac-Man a burst of extra speed.

The graphics are pixel-art upscaled versions of the original _Ms. Pac-Man_ arcade graphics.

_Ms. Pac-Man 2010_ also includes an online high-score system called the **Hall of Fame**. Scores from players around the planet are ranked separately for Blinky's World, Pinky's World, Inky's World, and Sue's World, with only the five best scores earning a place on each leaderboard. Pick a world, chase the high score, and see if you can get your initials into the **Hall of Fame**.

# Resources

_Ms. Pac-Man 2010_ is a reimplementation of the _Ms. Pac-Man_ arcade game, not an emulation. It does not run or include the original arcade ROM.

The source code for the project is available in the [meatfighter/ms-pac-man-2010-js repository](__REPOSITORY_URL__).

The Java desktop version is available as a [ZIP file](__DESKTOP_ZIP__). To use a gamepad with the Java version, connect and enable it before starting the game.

Download and extract the ZIP, then run the launcher for your operating system:

- Windows: `run-windows.cmd`
- Linux: `run-linux.sh`
- macOS: `run-macos.sh`

Java 21 or newer is required.

# Acknowledgements

The original _Pac-Man_ was designed by Toru Iwatani and developed by Namco. _Ms. Pac-Man_ was developed by the General Computer Corporation and Midway.

_Ms. Pac-Man 2010_ draws from the large collection of unofficial _Pac-Man_ and _Ms. Pac-Man_ arcade modifications and conversion kits that appeared over the years. Some of its mazes were borrowed from, or inspired by, games such as _Hangly-Man_, _New Puck-X_, _Piranha_, and _Ms. Pac-Man Plus_.

The music and sound effects in _Ms. Pac-Man 2010_ come from the arcade versions of _Ms. Pac-Man_ and _Pac-Mania_, the latter of which features music and sound by Junko Ozawa, Yuriko Keino, and Yoshito Tomuro. Some of the music and sound effects used in the cutscenes come from _Mike Tyson's Punch-Out!!_ for the NES, with music and sound by Kenji Yamamoto, Yukio Kaneoka, and Akito Nakatsuka.

This project is an unofficial fan-made tribute to the original games. It is not affiliated with, sponsored by, or endorsed by Bandai Namco Entertainment, Midway, Nintendo, or Capcom. The original games, graphics, music, sound effects, characters, and other content remain the property of their respective rights holders.

I provide _Ms. Pac-Man 2010_ free of charge. It contains no advertising and generates no revenue.
