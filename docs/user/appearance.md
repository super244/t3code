<!-- agent-watermark: model=gpt-6.1-sol; effort=high; duration=19m; seat=codex; date=2026-10-04 -->
<!-- agent-watermark: model=gpt-6.1-sol; effort=high; duration=22m; seat=codex; date=2026-10-03 -->

# Appearance and themes

Open **Settings → Appearance** to choose a theme and follow the system appearance or stay in light
or dark mode. To use different themes for light and dark mode, select the corresponding preview
within each theme. Appearance preferences are saved separately on each device or browser.

Mobile has its own themes and text, code, and terminal preferences. It does not follow environment
themes or defaults.

On Android 12 or newer, choose the **Material You** theme in Appearance to use colors from
your wallpaper. Selecting another theme replaces those colors. Like other themes, Material You
can be selected separately for light and dark appearances.
Android also offers **Material You Layout**, which changes shapes and spacing independently
of the selected theme.

## Sound effects

On web and desktop, use the sidebar sound control or **Settings → Appearance** to
choose a sound pack, set volume, or mute cues. Previews use the selected pack and
volume, even when automatic cues are disabled. The Silent pack and zero volume
also silence previews. Sound preferences belong to this browser or desktop profile;
if storage is unavailable, changes remain usable for the current session.

## Motion

The main sidebar, right panel, and terminal drawer open and close immediately by default. Move the
**Panel animations** slider above 0 ms to add motion, up to 400 ms, unless reduced motion is enabled
in your operating system. Moving between threads always snaps to the selected thread's panel state
without replaying its transitions.

## Prism palettes in this custom app

The sidebar's Prism selector offers built-in palettes. **Sync host** reads Prism
settings on your primary connected environment and selects a matching palette.
It reports unavailable settings, unsupported themes, or write failures; choosing
a built-in palette works independently of host sync. Sync requires an authenticated
connection with permission to operate on that environment.

This bridge reads `~/Library/Application Support/Prism/settings.json` with an
`activeThemeID` entry. If your Prism installation does not publish that file,
choose a palette manually. Successful sync publishes the palette in that server's
configured themes directory.

## Custom themes

On web and desktop, choose **Create theme** to adjust a palette, or import a T3 Code or VS Code
theme. The theme editor's color picker lets you select an area of the app to find the color to
change. Export your theme as JSON to share it.

## Environment themes

Environment themes and defaults come from the server serving your web app or the desktop app's
main local environment. app.t3.codes and additional connections do not use them.

Select a published theme in **Settings → Appearance** to follow its palette as the server updates
it. **Duplicate** makes an independent copy you can edit. A saved custom theme with the same ID
takes precedence. If the server stops publishing the selected theme, T3 Code falls back to its
standard theme.

Run this on the server to set a default and switch connected clients to it:

```bash
t3 theme set nightfall
```

Clients that are offline apply it when they reconnect. Each client applies the setting once;
choosing another theme afterward sticks until the next `t3 theme set`. Run the command again to
reapply it, even if the name is unchanged.

`t3 theme clear` removes the default without changing anyone's current theme. `t3 theme show` lists
the default and published themes.

### Publish a theme

Save a theme exported from T3 Code into `~/.t3/userdata/themes/` on the server, or the `themes`
directory under your custom state directory. The filename supplies the theme ID: `nightfall.json`
can be selected with `t3 theme set nightfall`. Keep the filename stable when updating its colors.
Do not use `system`, `light`, `dark`, or a built-in theme's ID.

For an integration that generates a palette, this shorter format also works:

```json
{
  "name": "Nightfall",
  "appearance": "dark",
  "canvas": "#1a1b26",
  "accent": "#7aa2f7",
  "colors": {
    "terminalSelection": "#292e42",
    "error": "#f7768e"
  }
}
```

Set `appearance` to `light` or `dark` and supply hex colors for `canvas` and `accent`. T3 Code
generates the rest. The optional `colors` overrides use the names in the theme editor's advanced
view.

Write updates to a temporary file and rename it into place so clients never read a partial theme.
Invalid files are not published.
