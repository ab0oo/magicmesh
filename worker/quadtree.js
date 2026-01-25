export class Quadtree {
  constructor(bounds, capacity = 6) {
    this.bounds = bounds;
    this.capacity = capacity;
    this.points = [];
    this.divided = false;
  }

  contains(point) {
    const { x, y, w, h } = this.bounds;
    return (
      point.x >= x &&
      point.x <= x + w &&
      point.y >= y &&
      point.y <= y + h
    );
  }

  intersects(range) {
    const { x, y, w, h } = this.bounds;
    return !(
      range.x > x + w ||
      range.x + range.w < x ||
      range.y > y + h ||
      range.y + range.h < y
    );
  }

  subdivide() {
    const { x, y, w, h } = this.bounds;
    const hw = w / 2;
    const hh = h / 2;
    this.northwest = new Quadtree({ x, y, w: hw, h: hh }, this.capacity);
    this.northeast = new Quadtree({ x: x + hw, y, w: hw, h: hh }, this.capacity);
    this.southwest = new Quadtree({ x, y: y + hh, w: hw, h: hh }, this.capacity);
    this.southeast = new Quadtree(
      { x: x + hw, y: y + hh, w: hw, h: hh },
      this.capacity
    );
    this.divided = true;
  }

  insert(point) {
    if (!this.contains(point)) {
      return false;
    }
    if (this.points.length < this.capacity) {
      this.points.push(point);
      return true;
    }
    if (!this.divided) {
      this.subdivide();
    }
    return (
      this.northwest.insert(point) ||
      this.northeast.insert(point) ||
      this.southwest.insert(point) ||
      this.southeast.insert(point)
    );
  }

  query(range, found = []) {
    if (!this.intersects(range)) {
      return found;
    }
    for (const point of this.points) {
      if (
        point.x >= range.x &&
        point.x <= range.x + range.w &&
        point.y >= range.y &&
        point.y <= range.y + range.h
      ) {
        found.push(point);
      }
    }
    if (this.divided) {
      this.northwest.query(range, found);
      this.northeast.query(range, found);
      this.southwest.query(range, found);
      this.southeast.query(range, found);
    }
    return found;
  }
}

