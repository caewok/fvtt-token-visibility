[![Version (latest)](https://img.shields.io/github/v/release/caewok/fvtt-token-visibility)](https://github.com/caewok/fvtt-token-visibility/releases/latest)
[![Foundry Version](https://img.shields.io/badge/dynamic/json.svg?url=https://github.com/caewok/fvtt-token-visibility/releases/latest/download/module.json&label=Foundry%20Version&query=$.compatibility.verified&colorB=blueviolet)](https://github.com/caewok/fvtt-token-visibility/releases/latest)
[![License](https://img.shields.io/github/license/caewok/fvtt-token-visibility)](LICENSE)

![Forge Installs](https://img.shields.io/badge/dynamic/json?label=Forge%20Installs&query=package.installs&suffix=%25&url=https://forge-vtt.com/api/bazaar/package/tokenvisibility&colorB=4aa94a)
![Latest Release Download Count](https://img.shields.io/github/downloads/caewok/fvtt-token-visibility/latest/module.zip)
![All Downloads](https://img.shields.io/github/downloads/caewok/fvtt-token-visibility/total)

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/H2H3Y7IJW)

# Alternative Token Visibility
This module provides options to modify Foundry's default methods for measuring visibility range and line-of-sight between tokens. Some options are more performant, while others trade some performance for a more precise method of computing visibility. Alt Token Visibility is particularly useful when dealing with token elevations, elevated tiles, and walls with limited heights or depth.

Major features:
- Choose whether one or more points on the viewing target are tested for line-of-sight, with the best result taken. Options include a "stereo" version that uses two points on the front facing side of the token.
- Change the number of points used to determine range.
- Adjust viewer and target line-of-sight point locations, shifting from the token border to the center.
- Account for wall height (using the [Wall Height](https://github.com/theripper93/wall-height) module) and overhead tiles.
- Adjust the vision height for tokens and prone tokens.
- Debugging mode to visualize the line-of-sight and range.
- Optionally have live, dead, or prone tokens block line-of-sight.

As of v0.6.0, all features related to cover calculations have been split off to a new module, [Alternative Token Cover](https://github.com/caewok/fvtt-token-cover).

# Installation
Add this [Manifest URL](https://github.com/caewok/fvtt-token-visibility/releases/latest/download/module.json) in Foundry to install.

# Dependencies
- [libWrapper](https://github.com/ruipin/fvtt-lib-wrapper)

# Recommended module additions
- [Wall Height](https://github.com/theripper93/wall-height). Not only does Wall Height provide the ability to set elevation for wall tops and bottoms, it also gives tokens height based on their size. The Area3d option for Alt Token Visibility takes full advantage of token height.
- [Token Lean](https://github.com/WesBelmont/token-lean). Useful when you want players to be able to "peer" over limited-height walls.

# Token Height
Token height, for purposes of measuring vision, can be changed using the [Wall Height](https://github.com/theripper93/wall-height) module. Token height is otherwise set based on scale of the token—namely,the number of grid squares it occupies.

Note that very large tokens can be quite tall, and may poke through an overhead tile. Depending on your settings, this may cause large tokens to be visible if a sufficient portion of the token is visible.

# Line-of-Sight Algorithm choices
Line-of-sight means testing from a specific point-of-view (the "eye") in 3d space to a target token. Depending on the algorithm, one or more points associated with the target may be tested, or the target may be considered as a whole. Obstacles can include walls, regions, or tiles. Alpha transparency of tiles may be considered.

Alt. Token Visibility currently offers four choices for how line-of-sight should be calculated. Some versions may be preferable for different gaming rules. Performance varies in ways that are not always predictable. As a general rule, the Points algorithm is usually fastest, and should almost always be substantially faster than the Surface Points Lattice algorithm. Depending on scene and computer, the WebGL version may be fastest.

To benchmark the algorithms for the current settings, testing the view of every token against every other token in a scene:
```js
N = 10;
await game.modules.get("tokenvisibility").api.bench.benchTokenLOS(N);
```
(If tokens are controlled, only those will be considered "viewers." If tokens are targeted, only those tokens will be considered "targets.")

## Points
Test whether a 3d ray from a point in the viewer token to a point on the target token is blocked by an obstacle. Multiple points on the target can be tested to determine whether a threshold percentage of rays is met for visibility. For overhead tiles, considers them to block unless the ray passes through a transparent portion of the tile.

This algorithm mimics the default Foundry VTT visibility test, but provides more options to vary the points used for testing. Unlike the Surface Points Lattice, these points may be "inside" the target token.

## Surface Points Lattice
For a grid of points on the surface of the 3d target token, test each point for visibility from point of viewer of a viewer token. Similar to the Points algorithm in that rays to points are individually tested. But it only considers the points for the surfaces facing the viewer. (E.g., for a cube token shape this would be either two or three faces in view.)

Slower because of the number of points tested. Capabable of approximating the percent surface viewed.

Note that Surface Points Lattice does not use a 2d projection. Therefore, the viewable sides are treated equally, regardless of area viewable via perspective. In other words, from the viewer perspective, one of the target token cube faces usually appears much larger than the other one or two viewable faces, but the points on all viewable faces receive the same weight. Switching to a spherical token shape alleviates this. (`CONFIG.tokenvisibility.useTokenSphere=true`).

## Geometric
Views the target token in perspective from the points of view of the viewer token, with obstacles projected on top. Essentially mimics the perspective view of WebGL, but measures area precisely using the underlying geometry of the target token shape and relevant obstacles.

## WebGL
Test the percentage of the 3d view of a target token that is viewable from the perspective of a point on the viewer token. The "percentage viewable" is approximated by counting the pixels in the resulting WebGL image of the rendered target with obstacles overlaid.

# Main Settings Menu

## Debug Range and Debug LOS
When enabled, these will visualize the range and line-of-sight algorithms on the canvas. Range is indicated by dots on the target tokens, red for out-of-range and green for in-range. A popout window displays a 3d version, with perspective, of the target for the given algorithm.

## Light Monitor
A new feature, still experimental, that identifies tokens that are in full darkness or dim light. "Per Token" considers each token's position with respect to lights in the scene. "Viewpoint" considers each token with respect to the controlled viewing token. For "Viewpoint," only the viewable faces are considered, whereas "Per Token" considers all the token faces.

Currently uses the Surface Points Lattice algorithm to associate lighting with each face. `CONFIG.tokenvisibility.lightMeter.dimCutoff` and `CONFIG.tokenvisibility.lightMeter.brightCutoff` control the percentage of points required to be "lit" to be considered within dim or bright light, respectively.

# ATV Settings Configuration Menu
Most of the relevant ATV module settings appear in a popout when you hit the "Configure" button in the main settings menu.

## Viewer Line-of-Sight
Settings relevant to the viewing token.

The viewing points are the viewing token's "eyes." If more than one viewing point, the viewer will have line-of-sight to the target if at least one point would have line-of-sight. When more than one point is used, an "offset" allows you to determine how far each point lies on a line between the viewer center and the viewer border. If two points are used, they are set to the token's front-facing direction.

## Target Line-of-Sight
Settings relevant to the target token.

### Algorithm
How to measure line-of-sight. If Points is selected, you can further customize the configuration of points and their inset. This is comparable to the viewing points configuration in the Viewer LOS.

### Percent Threshold
The percent threshold governs how much of a target token must be viewable for a viewing token to be considered to have line-of-sight to the target. For point-based algorithms, this is the percent of points that are visible on the target. For Geometric and WebGL algorithms, this is the percent area visible compared to what the target area would be with no obstacles. Note that targets against a wall will have their token shape trimmed accordingly, so that they are not visible through the wall.

### Large Token Subtargeting
If enabled, tokens larger than a grid square will be considered visible if at least one grid square's worth of the token is visible. For the Points algorithm, each grid square that the target occupies is tested separately as if it were a single token. For the Area2d and Area3d algorithms, the percentage area required is based on the size of a single grid square instead of the size of the entire target. The result is that tokens larger than a grid square can be more than 100% visible.

This setting is slightly less performant but very useful for larger tokens. For example, without large token subtargeting, 3 grid squares of a dragon could be visible and—depending on your percentage threshold setting—this may still be insufficient to "see" the dragon.

## Range
Settings relevant to calculating range between the viewer and target.

Options are provided to adjust how many points are tested when calculating range. The viewer center point is always used, and if any point on the target is within range, the target will be considered within range. Note that the difference in performance between these options is negligible, and so you should select whatever makes sense in your campaign setting.

## Other
Other settings that affect the line-of-sight calculation.

Optionally, you can have live or dead tokens block vision. Prone tokens can also optionally block vision. For these settings to work, you must tell ATV what the prone status is for your system, and where to find the hit points attribute. (It is assumed that 0 or below means "dead" for purposes of defining dead tokens.)

The vision height multiplier allows you to change the height at which a viewing token observes the scene. Think of this as the height of the eyes of the token above the ground, as a percentage of the total token height.

# Performance
You can test performance on a given scene by running the following code in the console. This will test whether the tokens in the scene can see every other token in the scene for a variety of settings. If you control one or more tokens, those will be treated as the viewing tokens. Targeting one or more tokens will test those targets against the viewing tokens.

```js
api = game.modules.get('tokenvisibility').api;
N = 10; // Change if you want more iterations.
await api.bench.benchTokenRange(N);
await api.bench.benchTokenLOS(N);
await api.bench.benchTokenVisibility(); // Bench from the current user's controlled tokens view.
```

# API
Various methods and classes are exposed at `game.modules.get('tokenvisibility').api`. These may change over time as this module evolves.
Various defined values are exposed at `CONFIG.tokenvisibility`.

Feel free to message me in Discord if you have questions about specific methods.
