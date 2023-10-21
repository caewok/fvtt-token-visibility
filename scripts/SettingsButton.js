/* globals
FormApplication
*/
"use strict";

export class SettingsButton extends FormApplication {
  static buttonFn = () => console.error("SettingsButton|Button function must be overridden by subclass.");

  render() {
    this.buttonFn().catch(err => console.error(err));
    return this;
  }
}
