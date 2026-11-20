$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$tileCache = Join-Path $root '.tilecache'
$dataDir = Join-Path $root 'data'
$iconsDir = Join-Path $root 'icons'

New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
New-Item -ItemType Directory -Force -Path $iconsDir | Out-Null

$csharp = @'
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

public static class TerrainBuilder
{
    const int TileMinX = 149;
    const int TileMaxX = 154;
    const int TileMinY = 102;
    const int TileMaxY = 107;
    const int TileSize = 256;
    const int Zoom = 8;

    static double MercY(double latDeg)
    {
        double rad = latDeg * Math.PI / 180.0;
        return Math.Log(Math.Tan(Math.PI / 4.0 + rad / 2.0));
    }

    static double InvMercY(double mercY)
    {
        return (2.0 * Math.Atan(Math.Exp(mercY)) - Math.PI / 2.0) * 180.0 / Math.PI;
    }

    static double Clamp(double v, double lo, double hi)
    {
        return v < lo ? lo : (v > hi ? hi : v);
    }

    static double Smoothstep(double edge0, double edge1, double x)
    {
        double t = Clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
        return t * t * (3.0 - 2.0 * t);
    }

    static void LerpRgb(double[] a, double[] b, double t, out double r, out double g, out double bl)
    {
        t = Clamp(t, 0.0, 1.0);
        r = a[0] + (b[0] - a[0]) * t;
        g = a[1] + (b[1] - a[1]) * t;
        bl = a[2] + (b[2] - a[2]) * t;
    }

    static void SampleRamp(double t, double[][] stops, double[] pos, out double r, out double g, out double b)
    {
        t = Clamp(t, pos[0], pos[pos.Length - 1]);
        for (int i = 0; i < pos.Length - 1; i++)
        {
            if (t <= pos[i + 1])
            {
                double local = (t - pos[i]) / Math.Max(1e-9, pos[i + 1] - pos[i]);
                LerpRgb(stops[i], stops[i + 1], local, out r, out g, out b);
                return;
            }
        }
        var last = stops[stops.Length - 1];
        r = last[0]; g = last[1]; b = last[2];
    }

    public static void Build(string tileCacheDir, string dataDir, string iconsDir)
    {
        int tilesX = TileMaxX - TileMinX + 1;
        int tilesY = TileMaxY - TileMinY + 1;
        int srcW = tilesX * TileSize;
        int srcH = tilesY * TileSize;

        double[] srcElev = new double[srcW * srcH];

        Console.WriteLine("Loading 36 Terrarium tiles...");
        for (int tx = TileMinX; tx <= TileMaxX; tx++)
        {
            for (int ty = TileMinY; ty <= TileMaxY; ty++)
            {
                string tilePath = Path.Combine(tileCacheDir, string.Format("8_{0}_{1}.png", tx, ty));
                if (!File.Exists(tilePath))
                    throw new FileNotFoundException("Missing tile: " + tilePath);

                using (Bitmap bmp = new Bitmap(tilePath))
                {
                    Rectangle rect = new Rectangle(0, 0, TileSize, TileSize);
                    BitmapData bd = bmp.LockBits(rect, ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
                    try
                    {
                        byte[] pixels = new byte[Math.Abs(bd.Stride) * TileSize];
                        Marshal.Copy(bd.Scan0, pixels, 0, pixels.Length);
                        int ox = (tx - TileMinX) * TileSize;
                        int oy = (ty - TileMinY) * TileSize;
                        for (int py = 0; py < TileSize; py++)
                        {
                            int rowOff = py * Math.Abs(bd.Stride);
                            int dstRow = (oy + py) * srcW + ox;
                            for (int px = 0; px < TileSize; px++)
                            {
                                int idx = rowOff + px * 4;
                                byte bVal = pixels[idx];
                                byte gVal = pixels[idx + 1];
                                byte rVal = pixels[idx + 2];
                                double e = (rVal * 256.0 + gVal + bVal / 256.0) - 32768.0;
                                srcElev[dstRow + px] = e;
                            }
                        }
                    }
                    finally
                    {
                        bmp.UnlockBits(bd);
                    }
                }
            }
        }

        double west = 30.2;
        double east = 37.2;
        double north = 33.4;
        double south = 27.6;
        double mercYN = MercY(north);
        double mercYS = MercY(south);

        int outW = 1400;
        int outH = 1330;
        double worldW = 24.0;
        double worldH = 22.8;

        double[] elev = new double[outW * outH];
        double worldPixels = TileSize * Math.Pow(2.0, Zoom);

        Console.WriteLine("Resampling DEM to " + outW + "x" + outH + " in Web Mercator...");
        for (int iy = 0; iy < outH; iy++)
        {
            double v = (iy + 0.5) / outH;
            double mY = mercYN + v * (mercYS - mercYN);
            double normY = (Math.PI - mY) / (2.0 * Math.PI);
            double gy = normY * worldPixels - TileMinY * TileSize;
            int y0 = (int)Math.Floor(gy);
            double fy = gy - y0;
            int y1 = Math.Min(srcH - 1, Math.Max(0, y0 + 1));
            y0 = Math.Min(srcH - 1, Math.Max(0, y0));

            for (int ix = 0; ix < outW; ix++)
            {
                double u = (ix + 0.5) / outW;
                double lon = west + u * (east - west);
                double normX = (lon + 180.0) / 360.0;
                double gx = normX * worldPixels - TileMinX * TileSize;
                int x0 = (int)Math.Floor(gx);
                double fx = gx - x0;
                int x1 = Math.Min(srcW - 1, Math.Max(0, x0 + 1));
                x0 = Math.Min(srcW - 1, Math.Max(0, x0));

                double e00 = srcElev[y0 * srcW + x0];
                double e10 = srcElev[y0 * srcW + x1];
                double e01 = srcElev[y1 * srcW + x0];
                double e11 = srcElev[y1 * srcW + x1];
                double e0 = e00 + (e10 - e00) * fx;
                double e1 = e01 + (e11 - e01) * fx;
                elev[iy * outW + ix] = e0 + (e1 - e0) * fy;
            }
        }

        // 1) Flood-fill ocean starting from open-sea border pixels so Jordan Rift Valley stays dry land
        bool[] isOcean = new bool[outW * outH];
        bool[] isLake = new bool[outW * outH];
        Queue<int> queue = new Queue<int>(8192);

        for (int iy = 0; iy < outH; iy++)
        {
            double v = (iy + 0.5) / outH;
            double lat = InvMercY(mercYN + v * (mercYS - mercYN));
            for (int ix = 0; ix < outW; ix++)
            {
                if (ix != 0 && ix != outW - 1 && iy != 0 && iy != outH - 1) continue;
                double u = (ix + 0.5) / outW;
                double lon = west + u * (east - west);
                int idx = iy * outW + ix;
                if (elev[idx] <= 0.8)
                {
                    // Guard: Jordan Rift / Yarmouk valley on eastern side should never seed ocean
                    if (lon > 35.15 && lat > 29.8) continue;
                    isOcean[idx] = true;
                    queue.Enqueue(idx);
                }
            }
        }

        int[] dxs = new int[] { -1, 1, 0, 0 };
        int[] dys = new int[] { 0, 0, -1, 1 };
        while (queue.Count > 0)
        {
            int cur = queue.Dequeue();
            int cx = cur % outW;
            int cy = cur / outW;
            for (int d = 0; d < 4; d++)
            {
                int nx = cx + dxs[d];
                int ny = cy + dys[d];
                if (nx < 0 || nx >= outW || ny < 0 || ny >= outH) continue;
                int nidx = ny * outW + nx;
                if (isOcean[nidx]) continue;
                if (elev[nidx] > 0.8) continue;

                double u = (nx + 0.5) / outW;
                double lon = west + u * (east - west);
                double v = (ny + 0.5) / outH;
                double lat = InvMercY(mercYN + v * (mercYS - mercYN));
                // Prevent any canal leak into Jordan/Arava rift basin
                if (lon >= 35.20 && lat >= 29.72 && lat <= 33.20) continue;

                isOcean[nidx] = true;
                queue.Enqueue(nidx);
            }
        }

        // 2) Mark inland lakes: Dead Sea, Sea of Galilee, Bitter Lakes / Timsah
        for (int iy = 0; iy < outH; iy++)
        {
            double v = (iy + 0.5) / outH;
            double lat = InvMercY(mercYN + v * (mercYS - mercYN));
            for (int ix = 0; ix < outW; ix++)
            {
                int idx = iy * outW + ix;
                if (isOcean[idx]) continue;
                double u = (ix + 0.5) / outW;
                double lon = west + u * (east - west);
                double e = elev[idx];

                // Dead Sea
                if (lat >= 30.98 && lat <= 31.80 && lon >= 35.31 && lon <= 35.61 && e <= -396.0)
                    isLake[idx] = true;
                // Sea of Galilee
                else if (lat >= 32.69 && lat <= 32.91 && lon >= 35.51 && lon <= 35.67 && e <= -204.0)
                    isLake[idx] = true;
                // Bitter Lakes & Lake Timsah
                else if (lat >= 30.18 && lat <= 30.63 && lon >= 32.22 && lon <= 32.63 && e <= 2.5)
                    isLake[idx] = true;
            }
        }

        // Compute distance to coast (2 passes approximate chamfer) for glowing coastal shallow turquoise
        int[] coastDist = new int[outW * outH];
        for (int i = 0; i < outW * outH; i++)
            coastDist[i] = (isOcean[i] || isLake[i]) ? 9999 : 0;

        for (int iy = 1; iy < outH - 1; iy++)
        {
            for (int ix = 1; ix < outW - 1; ix++)
            {
                int idx = iy * outW + ix;
                if (coastDist[idx] == 0) continue;
                int m = Math.Min(coastDist[idx - 1], coastDist[idx - outW]) + 1;
                if (m < coastDist[idx]) coastDist[idx] = m;
            }
        }
        for (int iy = outH - 2; iy >= 1; iy--)
        {
            for (int ix = outW - 2; ix >= 1; ix--)
            {
                int idx = iy * outW + ix;
                if (coastDist[idx] == 0) continue;
                int m = Math.Min(coastDist[idx + 1], coastDist[idx + outW]) + 1;
                if (m < coastDist[idx]) coastDist[idx] = m;
            }
        }

        // Land and Sea Color Ramps
        double[][] landStops = new double[][] {
            new double[] { 179, 152, 114 }, // -430m Jordan rift floor (warm mineral ochre)
            new double[] { 205, 185, 145 }, // 0m coastal plains & arid low ground
            new double[] { 212, 187, 140 }, // 200m Sinai desert sand
            new double[] { 196, 160, 112 }, // 550m plateau tan
            new double[] { 174, 128, 84 },  // 1000m sandstone highland
            new double[] { 148, 102, 66 },  // 1550m dark granite slope
            new double[] { 188, 160, 134 }, // 2150m high Sinai/Midian peaks
            new double[] { 222, 206, 188 }  // 2650m summit ridge highlight
        };
        double[] landPos = new double[] { -430, 0, 200, 550, 1000, 1550, 2150, 2650 };

        double[][] seaStops = new double[][] {
            new double[] { 66, 174, 190 }, // 0m shallow turquoise
            new double[] { 38, 134, 168 }, // -40m coastal shelf
            new double[] { 26, 94, 136 },  // -250m cerulean
            new double[] { 15, 52, 88 },   // -1000m deep blue
            new double[] { 9, 31, 56 }     // -2500m abyssal navy
        };
        double[] seaPos = new double[] { -2500, -1000, -250, -40, 0 };
        double[][] seaStopsOrdered = new double[][] {
            seaStops[4], seaStops[3], seaStops[2], seaStops[1], seaStops[0]
        };

        // Sun light vectors for hillshade (NW 315 deg, alt 40 deg + soft NE fill)
        double az1 = 315.0 * Math.PI / 180.0;
        double alt1 = 40.0 * Math.PI / 180.0;
        double lx1 = Math.Cos(alt1) * Math.Sin(az1);
        double ly1 = -Math.Cos(alt1) * Math.Cos(az1);
        double lz1 = Math.Sin(alt1);

        double metersPerPx = 560.0;
        byte[] imgBytes = new byte[outW * outH * 4];

        Console.WriteLine("Rendering relief.jpg hillshade and biome textures...");
        for (int iy = 0; iy < outH; iy++)
        {
            double v = (iy + 0.5) / outH;
            double lat = InvMercY(mercYN + v * (mercYS - mercYN));
            int ym = Math.Max(0, iy - 1);
            int yp = Math.Min(outH - 1, iy + 1);

            for (int ix = 0; ix < outW; ix++)
            {
                int idx = iy * outW + ix;
                double u = (ix + 0.5) / outW;
                double lon = west + u * (east - west);
                double e = elev[idx];

                int xm = Math.Max(0, ix - 1);
                int xp = Math.Min(outW - 1, ix + 1);

                double dzdx = (elev[iy * outW + xp] - elev[iy * outW + xm]) / (2.0 * metersPerPx);
                double dzdy = (elev[yp * outW + ix] - elev[ym * outW + ix]) / (2.0 * metersPerPx);

                double zExag = (isOcean[idx] || isLake[idx]) ? 0.55 : 2.35;
                double nx = -dzdx * zExag;
                double ny = -dzdy * zExag;
                double nz = 1.0;
                double invLen = 1.0 / Math.Sqrt(nx * nx + ny * ny + nz * nz);
                nx *= invLen; ny *= invLen; nz *= invLen;

                double diff = Clamp(nx * lx1 + ny * ly1 + nz * lz1, 0.0, 1.0);
                double slope = Math.Sqrt(dzdx * dzdx + dzdy * dzdy);

                double r, g, b;
                if (isOcean[idx])
                {
                    SampleRamp(e, seaStopsOrdered, seaPos, out r, out g, out b);
                    double shelfGlow = Math.Exp(-coastDist[idx] / 7.5);
                    r = r + (74 - r) * shelfGlow * 0.45;
                    g = g + (182 - g) * shelfGlow * 0.45;
                    b = b + (194 - b) * shelfGlow * 0.45;
                    double shade = 0.86 + diff * 0.22;
                    r *= shade; g *= shade; b *= shade;
                }
                else if (isLake[idx])
                {
                    double shade = 0.88 + diff * 0.16;
                    r = 34 * shade;
                    g = 116 * shade;
                    b = 148 * shade;
                }
                else
                {
                    SampleRamp(e, landStops, landPos, out r, out g, out b);

                    // Fertile Nile Delta & Wadi Tumilat green
                    double deltaMask = (1.0 - Smoothstep(31.8, 32.38, lon)) * Smoothstep(29.85, 30.35, lat) * (1.0 - Smoothstep(10.0, 26.0, e));
                    double wadiTumilat = Math.Exp(-Math.Pow((lat - (30.55 - (lon - 31.5) * 0.02)) / 0.11, 2.0)) * Smoothstep(31.3, 31.6, lon) * (1.0 - Smoothstep(32.2, 32.45, lon)) * (1.0 - Smoothstep(12.0, 28.0, e));
                    double nileStrip = Math.Exp(-Math.Pow((lon - 31.22) / 0.14, 2.0)) * (1.0 - Smoothstep(29.9, 30.2, lat)) * (1.0 - Smoothstep(18.0, 35.0, e));
                    double egyptGreen = Clamp(Math.Max(deltaMask, Math.Max(wadiTumilat, nileStrip)), 0.0, 0.88);
                    r = r + (108 - r) * egyptGreen * 0.72;
                    g = g + (142 - g) * egyptGreen * 0.72;
                    b = b + (82 - b) * egyptGreen * 0.72;

                    // Canaan coastal plain & Galilee sage green
                    double canaanGreen = Smoothstep(31.25, 32.25, lat) * (1.0 - Smoothstep(35.05, 35.55, lon)) * (1.0 - Smoothstep(350.0, 750.0, e));
                    r = r + (142 - r) * canaanGreen * 0.44;
                    g = g + (152 - g) * canaanGreen * 0.44;
                    b = b + (96 - b) * canaanGreen * 0.44;

                    // Jordan valley oasis fertility ribbon
                    double jordanGreen = Math.Exp(-Math.Pow((lon - 35.52) / 0.09, 2.0)) * Smoothstep(31.78, 32.0, lat) * (1.0 - Smoothstep(33.0, 33.3, lat));
                    r = r + (128 - r) * jordanGreen * 0.42;
                    g = g + (146 - g) * jordanGreen * 0.42;
                    b = b + (92 - b) * jordanGreen * 0.42;

                    // Crisp directional hillshade + canyon slope accent
                    double shade = 0.56 + 0.66 * diff - Clamp(slope * 0.32, 0.0, 0.16);
                    r *= shade; g *= shade; b *= shade;

                    // Subtle crisp coastline rim where land meets water
                    bool touchesWater = false;
                    if (ix > 0 && (isOcean[idx - 1] || isLake[idx - 1])) touchesWater = true;
                    else if (ix < outW - 1 && (isOcean[idx + 1] || isLake[idx + 1])) touchesWater = true;
                    else if (iy > 0 && (isOcean[idx - outW] || isLake[idx - outW])) touchesWater = true;
                    else if (iy < outH - 1 && (isOcean[idx + outW] || isLake[idx + outW])) touchesWater = true;
                    if (touchesWater)
                    {
                        r *= 0.84; g *= 0.86; b *= 0.82;
                    }
                }

                int p = idx * 4;
                imgBytes[p] = (byte)Clamp(b, 0, 255);
                imgBytes[p + 1] = (byte)Clamp(g, 0, 255);
                imgBytes[p + 2] = (byte)Clamp(r, 0, 255);
                imgBytes[p + 3] = 255;
            }
        }

        string reliefPath = Path.Combine(dataDir, "relief.jpg");
        using (Bitmap outBmp = new Bitmap(outW, outH, PixelFormat.Format32bppArgb))
        {
            BitmapData obd = outBmp.LockBits(new Rectangle(0, 0, outW, outH), ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
            Marshal.Copy(imgBytes, 0, obd.Scan0, imgBytes.Length);
            outBmp.UnlockBits(obd);

            ImageCodecInfo jpgCodec = null;
            foreach (var c in ImageCodecInfo.GetImageEncoders())
                if (c.FormatID == ImageFormat.Jpeg.Guid) { jpgCodec = c; break; }
            EncoderParameters ep = new EncoderParameters(1);
            ep.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, 92L);
            outBmp.Save(reliefPath, jpgCodec, ep);
        }

        // 3) Downsample to 512 x 480 for height.bin & seamask.png
        int gridW = 512;
        int gridH = 480;
        byte[] heightBytes = new byte[gridW * gridH * 2];
        byte[] maskBytes = new byte[gridW * gridH * 4];
        double minLand = 99999, maxLand = -99999;

        for (int gy = 0; gy < gridH; gy++)
        {
            double sy = (gy + 0.5) / gridH * (outH - 1);
            int sy0 = (int)Math.Floor(sy);
            int sy1 = Math.Min(outH - 1, sy0 + 1);
            double fy = sy - sy0;

            for (int gx = 0; gx < gridW; gx++)
            {
                double sx = (gx + 0.5) / gridW * (outW - 1);
                int sx0 = (int)Math.Floor(sx);
                int sx1 = Math.Min(outW - 1, sx0 + 1);
                double fx = sx - sx0;

                double e00 = elev[sy0 * outW + sx0];
                double e10 = elev[sy0 * outW + sx1];
                double e01 = elev[sy1 * outW + sx0];
                double e11 = elev[sy1 * outW + sx1];
                double e = (e00 + (e10 - e00) * fx) * (1.0 - fy) + (e01 + (e11 - e01) * fx) * fy;

                int nearIdx = (int)Math.Round(sy) * outW + (int)Math.Round(sx);
                bool oc = isOcean[nearIdx];
                bool lk = isLake[nearIdx];

                if (!oc && !lk)
                {
                    if (e < minLand) minLand = e;
                    if (e > maxLand) maxLand = e;
                }

                short eInt = (short)Math.Round(Clamp(e, -2500.0, 3000.0));
                int hOff = (gy * gridW + gx) * 2;
                heightBytes[hOff] = (byte)(eInt & 0xFF);
                heightBytes[hOff + 1] = (byte)((eInt >> 8) & 0xFF);

                int mOff = (gy * gridW + gx) * 4;
                maskBytes[mOff] = 0;
                maskBytes[mOff + 1] = (byte)(lk ? 255 : 0);
                maskBytes[mOff + 2] = (byte)(oc ? 255 : 0);
                maskBytes[mOff + 3] = 255;
            }
        }

        File.WriteAllBytes(Path.Combine(dataDir, "height.bin"), heightBytes);

        using (Bitmap maskBmp = new Bitmap(gridW, gridH, PixelFormat.Format32bppArgb))
        {
            BitmapData mbd = maskBmp.LockBits(new Rectangle(0, 0, gridW, gridH), ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
            Marshal.Copy(maskBytes, 0, mbd.Scan0, maskBytes.Length);
            maskBmp.UnlockBits(mbd);
            maskBmp.Save(Path.Combine(dataDir, "seamask.png"), ImageFormat.Png);
        }

        string metaJson = string.Format(
            CultureInfo.InvariantCulture,
            "{{\n" +
            "  \"west\": {0:F4},\n" +
            "  \"east\": {1:F4},\n" +
            "  \"north\": {2:F4},\n" +
            "  \"south\": {3:F4},\n" +
            "  \"mercYNorth\": {4:F8},\n" +
            "  \"mercYSouth\": {5:F8},\n" +
            "  \"gridW\": {6},\n" +
            "  \"gridH\": {7},\n" +
            "  \"worldW\": {8:F2},\n" +
            "  \"worldH\": {9:F2},\n" +
            "  \"minLandElev\": {10:F1},\n" +
            "  \"maxLandElev\": {11:F1}\n" +
            "}}",
            west, east, north, south, mercYN, mercYS, gridW, gridH, worldW, worldH, minLand, maxLand
        );
        File.WriteAllText(Path.Combine(dataDir, "meta.json"), metaJson, Encoding.UTF8);

        // 4) Spot-check landmarks directly from heightBytes + maskBytes
        Action<string, double, double> spotCheck = (label, lat, lon) =>
        {
            double u = (lon - west) / (east - west);
            double v = (mercYN - MercY(lat)) / (mercYN - mercYS);
            int gx = Math.Min(gridW - 1, Math.Max(0, (int)Math.Round(u * (gridW - 1))));
            int gy = Math.Min(gridH - 1, Math.Max(0, (int)Math.Round(v * (gridH - 1))));
            int hOff = (gy * gridW + gx) * 2;
            short hVal = (short)(heightBytes[hOff] | (heightBytes[hOff + 1] << 8));
            int mOff = (gy * gridW + gx) * 4;
            bool oc = maskBytes[mOff + 2] > 128;
            bool lk = maskBytes[mOff + 1] > 128;
            Console.WriteLine("  [SpotCheck] {0,-22} ({1:F3}, {2:F3}) -> elev={3,5}m | ocean={4} lake={5}",
                label, lat, lon, hVal, oc ? 1 : 0, lk ? 1 : 0);
        };

        Console.WriteLine("=== Elevation & Mask Spot Checks ===");
        spotCheck("Jebel Musa (Sinai)", 28.539, 33.975);
        spotCheck("Jebel Katherina", 28.509, 33.955);
        spotCheck("Dead Sea", 31.500, 35.480);
        spotCheck("Jericho (Tell es-Sultan)", 31.871, 35.444);
        spotCheck("Pi-Ramesses (Qantir)", 30.799, 31.832);
        spotCheck("Mediterranean Sea", 32.500, 31.000);
        spotCheck("Gulf of Aqaba", 28.800, 34.750);
        spotCheck("Mount Ebal", 32.234, 35.274);

        // 5) Generate icons/icon-192.png
        BuildIcon(Path.Combine(iconsDir, "icon-192.png"));
    }

    static void BuildIcon(string path)
    {
        using (Bitmap bmp = new Bitmap(192, 192, PixelFormat.Format32bppArgb))
        using (Graphics g = Graphics.FromImage(bmp))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.Clear(Color.Transparent);

            using (var bgBrush = new LinearGradientBrush(new Rectangle(0, 0, 192, 192),
                Color.FromArgb(255, 16, 29, 27), Color.FromArgb(255, 10, 20, 18), 45f))
            using (var gp = new GraphicsPath())
            {
                int r = 36;
                gp.AddArc(0, 0, r, r, 180, 90);
                gp.AddArc(192 - r, 0, r, r, 270, 90);
                gp.AddArc(192 - r, 192 - r, r, r, 0, 90);
                gp.AddArc(0, 192 - r, r, r, 90, 90);
                gp.CloseFigure();
                g.FillPath(bgBrush, gp);
            }

            // Sea band
            using (var seaBrush = new SolidBrush(Color.FromArgb(220, 34, 108, 138)))
            {
                g.FillRectangle(seaBrush, 20, 128, 152, 34);
            }

            // Sinai mountain silhouette
            Point[] mtn1 = { new Point(22, 134), new Point(74, 52), new Point(122, 134) };
            Point[] mtn2 = { new Point(72, 134), new Point(124, 68), new Point(170, 134) };
            using (var b1 = new SolidBrush(Color.FromArgb(255, 182, 122, 72)))
            using (var b2 = new SolidBrush(Color.FromArgb(255, 229, 185, 111)))
            {
                g.FillPolygon(b2, mtn2);
                g.FillPolygon(b1, mtn1);
            }

            // Pillar of fire glow beam above Sinai
            using (var beamBrush = new LinearGradientBrush(new Point(74, 18), new Point(74, 64),
                Color.FromArgb(60, 255, 214, 138), Color.FromArgb(240, 244, 185, 95)))
            {
                g.FillRectangle(beamBrush, 70, 20, 8, 38);
            }
            using (var sunBrush = new SolidBrush(Color.FromArgb(255, 255, 226, 150)))
            {
                g.FillEllipse(sunBrush, 68, 46, 12, 12);
            }

            bmp.Save(path, ImageFormat.Png);
        }
    }
}
'@

Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition $csharp
[TerrainBuilder]::Build($tileCache, $dataDir, $iconsDir)
Write-Host 'Terrain build completed successfully.'
