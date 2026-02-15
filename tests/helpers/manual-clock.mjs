export class ManualClock {
  /**
   * @param {string|Date} seed
   */
  constructor(seed) {
    this.current = new Date(seed);
  }

  /**
   * @returns {Date}
   */
  now = () => new Date(this.current);

  /**
   * @param {number} seconds
   */
  advanceSeconds(seconds) {
    this.current = new Date(this.current.getTime() + seconds * 1000);
  }
}
