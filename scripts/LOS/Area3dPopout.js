/* globals
Application,
Hooks,
PIXI
*/
"use strict";
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
import { MODULE_ID } from "./const.js";

export const area3dPopoutData = {
  savedTop: null,
  savedLeft: null,
  app: null,
  shown: false
};

export class Area3dPopout extends Application {

  graphics = new PIXI.Graphics();

  /* -------------------------------------------- */

  /** @override */
  static get defaultOptions() {
    const options = super.defaultOptions;

    // Default positioning
    // If width calc is necessary:
    // let h = window.innerHeight * 0.9,
    // w = Math.min(window.innerWidth * 0.9, 1200);
    options.top = area3dPopoutData.savedTop;
    options.left = area3dPopoutData.savedLeft;
    // Other possible options:
    // options.top = (window.innertop - this.h) / 2;
    // options.left = (window.innerleft - this.w) / 2;
    options.id = "area3dpopout";
    options.template = `modules/${MODULE_ID}/templates/area3d_popout.html`;
    options.popOut = true;
    options.minimizable = true;
    options.title = "Area3d Debug";
    return options;
  }

  /* -------------------------------------------- */

  /** @override */
  render(force=false, options={}) {
    super.render(force, options);
    area3dPopoutData.shown = true;

    // Add pixi app
    // this.pixiApp = new PIXI.Application({
    // width: 400, height: 400, view: document.getElementById("area3dcanvas"), backgroundColor: 0xD3D3D3 });
    // this.pixiApp = new PIXI.Application({
    // width: 400, height: 400, view: document.getElementById("area3dcanvas"), backgroundColor: 0xD3D3D3 });

    return this;
  }


  //   /* -------------------------------------------- */
  /** @override */
  close() {
    area3dPopoutData.shown = false;
    area3dPopoutData.savedTop = this.position.top;
    area3dPopoutData.savedLeft = this.position.left;
    this.graphics.clear();
    super.close();
  }
}

Hooks.on("canvasReady", function() {
  area3dPopoutData.app = new Area3dPopout();
});

Hooks.on("renderArea3dPopout", function(app, _html, _data) {
  app.pixiApp = new PIXI.Application({width: 400, height: 400, view: document.getElementById("area3dcanvas"), backgroundColor: 0xD3D3D3 });

  // Center of window should be 0,0
  app.pixiApp.stage.position.x = 200;
  app.pixiApp.stage.position.y = 200;

  // Scale to give a bit more room in the popout
  app.pixiApp.stage.scale.x = 0.5;
  app.pixiApp.stage.scale.y = 0.5;

  app.pixiApp.stage.addChild(app.graphics);
});

/* Testing
api = game.modules.get("tokenvisibility").api
Area3dPopout = api.Area3dPopout
popout = new Area3dPopout()
popout.render(true)

gr  = new PIXI.Graphics();
gr.beginFill(0x6200EE);
gr.lineStyle(3, 0xff0000);
gr.drawCircle(100, 100, 50);
gr.endFill();

popout.pixiApp.stage.addChild(gr)


class Popout extends Application {
  static get defaultOptions() {
    const options = super.defaultOptions;
    options.popOut = true;
    options.id = "popout";
    options.template = `modules/tokenvisibility/templates/area3d_popout.html`;
    return options;
  }
}

app = new Popout()
app.render(true)

pixiApp = new PIXI.Application({width: 400, height: 400, view: document.getElementById("area3dcanvas")})

gr  = new PIXI.Graphics();
gr.beginFill(0x6200EE);
gr.lineStyle(3, 0xff0000);
gr.drawCircle(100, 100, 50);
gr.endFill();
pixiApp.stage.addChild(gr)

*/
