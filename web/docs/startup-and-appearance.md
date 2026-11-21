# Startup and appearance

## Show the frame before restoring content

The application separates three milestones: the document can paint, React can mount the workspace,
and saved conversation data is ready. Waiting for all three before showing anything causes a blank
screen even though the layout itself does not depend on restored messages.

A small HTML frame paints the background and sidebar before application modules arrive. React then
mounts the wallpaper and matching layout while storage restoration continues. Conversation controls
appear when their data is ready. A storage failure still completes this handoff with usable local
content and a visible error notice.

The original frame stays visible through the handoff and fades away as the initial visible rows
enter. This keeps a continuous visual surface instead of replacing the screen abruptly. Only the
initial visible rows participate; later list updates and virtual remounts do not replay startup.
The cover never blocks ready controls, and reduced motion skips the decorative movement.

## Loading follows interaction expectations

First-screen UI and ordinary actions should be available as soon as the workspace is ready.
Conversation selection, settings, composition, and the media viewer use static component imports;
opening them should not introduce a first-click loading screen merely to reduce a bundle.

Existing on-demand catalogs, animation assets, and language grammars have their own resource
loading policies. Virtualizing rows and scheduling image decoding reduce work without deferring an
entire interactive surface. A future loading change should be justified by the affected user flow,
not by bundle size alone.

## Appearance has one state owner

The appearance store keeps the selected mode and independent theme/wallpaper choices for each
variant. Switching modes does not overwrite the choices belonging to another variant. System mode
resolves against the operating-system preference while keeping the user's saved choices intact.

The initial document can read enough existing preferences to choose a suitable background without
writing storage. A fresh connected account follows the system setting. Previously saved modes,
including Classic, keep their chosen palette and wallpaper. Custom images resolve later, so startup
uses an immediate fallback while IndexedDB and image decoding complete.

## Treat an appearance change as one transition

Palette, accent, wallpaper, blur, and mode changes pass through one coordinator. Updating these
independently could show a new palette over an old image or combine conflicting animations.
Settings use a crossfade; the main-menu toggle supplies an explicit origin for a circular reveal.
Reduced motion and browsers without view transitions still apply the same state change.

Image selection has a preparation phase before publication. The previous wallpaper stays visible
and interactive while the next image is loaded and decoded. Only the latest selection may commit;
a late result from a superseded request must not replace it. Failed preparation keeps the previous
choice and reports the error.

Decoded image resources remain retained while preparation, transition snapshots, or the mounted
wallpaper need them. Releasing one owner must not revoke a URL still used by another. Once no owner
remains, the resource can be released. Image identifiers belong in preferences; blobs remain in
image storage.

Background animation playback pauses during transition snapshots to avoid competing rendering
work. Retained settings panels also keep focus and scrolling inside their own surfaces; revealing
a selected theme must not scroll an invisible ancestor or move the whole application.

See [architecture](./architecture.md) for state boundaries and
[development](./development.md) for verification guidance.

## Connected account screens

The credential card owns its scroll area so password managers and keyboard navigation can reveal
a focused field even on a short viewport. Floating labels remain associated with native inputs.
Server capabilities determine whether registration and recovery are available.

Settings resolves the signed-in user's photo through the session. The cover can expand after that
image loads. Search presents the account's available destinations, including local appearance
controls, and retains the query while a result is open. Browser Back returns to that search.
