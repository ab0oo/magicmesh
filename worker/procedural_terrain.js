export function createProceduralGenerator({ clamp }) {
    // Simple hash-based 2D noise for speed and lack of external dependencies
    function hash(x, y) {
        const h = x * 127.1 + y * 311.7;
        const s = Math.sin(h) * 43758.5453123;
        return s - Math.floor(s);
    }

    function noise(x, y) {
        const ix = Math.floor(x);
        const iy = Math.floor(y);
        const fx = x - ix;
        const fy = y - iy;

        const a = hash(ix, iy);
        const b = hash(ix + 1, iy);
        const c = hash(ix, iy + 1);
        const d = hash(ix + 1, iy + 1);

        const ux = fx * fx * (3 - 2 * fx);
        const uy = fy * fy * (3 - 2 * fy);

        return (a * (1 - ux) + b * ux) * (1 - uy) + (c * (1 - ux) + d * ux) * uy;
    }

    function fbm(x, y, octaves = 4, persistence = 0.5) {
        let value = 0;
        let amplitude = 1;
        let frequency = 1;
        for (let i = 0; i < octaves; i++) {
            value += amplitude * noise(x * frequency, y * frequency);
            amplitude *= persistence;
            frequency *= 2;
        }
        return value;
    }

    // Domain warping: f(p + g(p))
    function warpedNoise(x, y, strength = 1.5) {
        const qx = fbm(x + 0.0, y + 0.0, 2);
        const qy = fbm(x + 5.2, y + 1.3, 2);
        return fbm(x + strength * qx, y + strength * qy, 4);
    }

    // Simplified hydraulic erosion (droplet-based)
    function applyErosion(grid, width, height, iterations = 5000) {
        const inertia = 0.05;
        const sedimentCapacityFactor = 4;
        const minSedimentCapacity = 0.01;
        const dissolveSpeed = 0.3;
        const depositSpeed = 0.3;
        const gravity = 4;

        for (let i = 0; i < iterations; i++) {
            let posX = Math.random() * (width - 1);
            let posY = Math.random() * (height - 1);
            let dirX = 0;
            let dirY = 0;
            let speed = 1;
            let water = 1;
            let sediment = 0;

            for (let step = 0; step < 30; step++) {
                const ix = Math.floor(posX);
                const iy = Math.floor(posY);
                const u = posX - ix;
                const v = posY - iy;

                // Calculate gradient
                const g00 = grid[iy * width + ix];
                const g10 = grid[iy * width + ix + 1];
                const g01 = grid[(iy + 1) * width + ix];
                const g11 = grid[(iy + 1) * width + ix + 1];

                const gradX = (g10 - g00) * (1 - v) + (g11 - g01) * v;
                const gradY = (g01 - g00) * (1 - u) + (g11 - g10) * u;

                // Update direction and position
                dirX = dirX * inertia - gradX * (1 - inertia);
                dirY = dirY * inertia - gradY * (1 - inertia);
                const len = Math.hypot(dirX, dirY) || 1;
                dirX /= len;
                dirY /= len;

                const oldPosX = posX;
                const oldPosY = posY;
                posX += dirX;
                posY += dirY;

                if (posX < 0 || posX >= width - 1 || posY < 0 || posY >= height - 1) break;

                const hNew = grid[Math.floor(posY) * width + Math.floor(posX)];
                const hOld = g00; // Simplified
                const deltaH = hNew - hOld;

                const capacity = Math.max(-deltaH * speed * water * sedimentCapacityFactor, minSedimentCapacity);

                if (sediment > capacity || deltaH > 0) {
                    const deposit = deltaH > 0 ? Math.min(deltaH, sediment) : (sediment - capacity) * depositSpeed;
                    sediment -= deposit;
                    grid[iy * width + ix] += deposit;
                } else {
                    const erode = Math.min((capacity - sediment) * dissolveSpeed, -deltaH);
                    sediment += erode;
                    grid[iy * width + ix] -= erode;
                }

                speed = Math.sqrt(speed * speed + deltaH * gravity);
                water *= 0.99;
            }
        }
    }

    return {
        generate(type, width, height, scaleMpx = 10, seed = 0) {
            const grid = new Float32Array(width * height);
            let minH = Infinity;
            let maxH = -Infinity;

            // Use the seed to create coordinate offsets
            const offsetX = (seed * 1234.567) % 10000;
            const offsetY = (seed * 8901.234) % 10000;

            // Base Noise Pass
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const nx = x / 100 + offsetX;
                    const ny = y / 100 + offsetY;
                    let h = 0;

                    switch (type) {
                        case "alpine":
                            h = Math.pow(warpedNoise(nx * 2, ny * 2, 2.5), 2) * 3500;
                            break;
                        case "rolling_hills":
                            h = fbm(nx, ny, 3, 0.4) * 400;
                            break;
                        case "coastal":
                            const base = fbm(nx * 0.5, ny * 0.5, 3, 0.5);
                            h = (base * 150) - 40; // Some area below sea level
                            break;
                        case "desert":
                            const dunes = Math.abs(Math.sin(fbm(nx * 2, ny * 0.5, 2) * 10));
                            h = dunes * 80 + noise(nx * 5, ny * 5) * 10;
                            break;
                        case "flat-earth":
                        default:
                            h = 0;
                            break;
                    }
                    grid[y * width + x] = h;
                }
            }

            // Erosion Pass (except for flat/desert)
            if (type === "alpine" || type === "rolling_hills") {
                applyErosion(grid, width, height, type === "alpine" ? 8000 : 3000);
            }

            // Calculate bounds
            for (let i = 0; i < grid.length; i++) {
                if (grid[i] < minH) minH = grid[i];
                if (grid[i] > maxH) maxH = grid[i];
            }

            // Vertical scaling adjustment (ensure coastal has water)
            if (type === "coastal") {
                minH = -20;
            }

            return {
                grid,
                width,
                height,
                min_elevation_m: minH,
                max_elevation_m: maxH,
                bbox: {
                    min_lat: 0,
                    max_lat: height * scaleMpx / 111320,
                    min_lon: 0,
                    max_lon: width * scaleMpx / 111320
                }
            };
        }
    };
}