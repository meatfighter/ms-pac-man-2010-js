# Third-Party Notices

This project depends on slick2d-ts for the browser runtime. slick2d-ts is distributed under the BSD 3-Clause License and includes attribution for selected Slick2D API behavior.

Desktop Java runtime dependencies are documented separately in `desktop/RUNTIME_DEPENDENCIES.md`, `desktop/licenses/`, and `desktop/third-party-sources/`. The downloadable desktop package bundles legacy jars, native libraries, license texts, and corresponding-source artifacts; keep this notice file with that package.

## Bundled Desktop Runtime Summary

| Component                   | Included files                                       | SHA-256                                                                                                                                                                       | License / notice                                                                                                                                                                              |
| --------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Slick2D                     | `slick.jar`                                          | `02f7a1f0c48847a32fcc1a3330b12b869e73ad7658c7708174d9f1f2ec75847b`                                                                                                            | BSD 3-Clause License. Full notice reproduced below. The bundled jar contains only `META-INF/MANIFEST.MF`; it does not embed a license file.                                                   |
| LWJGL 2.8.5                 | `lwjgl.jar`, `lwjgl_util.jar`, bundled LWJGL natives | `lwjgl.jar`: `a31267bf348e564217d833cb0b334cfe4062aab12b015c126f323882949d1c1d`; `lwjgl_util.jar`: `2432cbacfcec9cd78165f44f45d045bafff9da122276ed288157699eeee688de`         | BSD-style license from the Lightweight Java Game Library project. Full notice reproduced below and in `desktop/licenses/LWJGL-2-BSD.txt`.                                                     |
| JInput                      | `jinput.jar`, bundled JInput natives                 | `36b6fbede7a2d2f00949a87b9de83007a1c6b4ce5a96978279c0cc612a9adef5`                                                                                                            | BSD-style license from the Java Game Technology Group / JInput project. Full notice included in `desktop/licenses/JINPUT-BSD.txt`.                                                            |
| OpenAL Soft 1.14            | bundled OpenAL native libraries                      | See `desktop/licenses/README.md` for per-file hashes.                                                                                                                         | GNU Library/Lesser GPL terms. The OpenAL native binaries identify `OpenAL Soft`, `OpenAL Community`, and `1.1 ALSOFT 1.14`; full text included in `desktop/licenses/GNU-LIBRARY-GPL-2.0.txt`. |
| JOrbis / JCraft Ogg support | `jogg-0.0.7.jar`, `jorbis-0.0.17.jar`                | `jogg-0.0.7.jar`: `2e2744b9bfada5e62ba274d6b3089656676599afacc095647234ae383b991ecc`; `jorbis-0.0.17.jar`: `7096b7eef82228c7aea0260fac4884aec416b332dfaac8182dea8c28ba35b45f` | GNU Lesser/Library General Public License according to JOrbis Maven metadata and source headers. Full text included in `desktop/licenses/GNU-LIBRARY-GPL-2.0.txt`.                            |
| Gson 2.11.0                 | `gson-2.11.0.jar`                                    | `57928d6e5a6edeb2abd3770a8f95ba44dce45f3b23b7a9dc2b309c581552a78b`                                                                                                            | Apache License 2.0. The jar metadata at `META-INF/maven/com.google.code.gson/gson/pom.xml` identifies Apache 2.0; full text included in `desktop/licenses/APACHE-2.0.txt`.                    |

The vendored desktop runtime set is intentionally conservative so the legacy Slick2D/LWJGL desktop version can still run on modern machines. If any bundled jar or native library is replaced, update this table, the hashes, and the runtime dependency notes before publishing a new release.

## slick2d-ts

BSD 3-Clause License

Copyright (c) 2026, meatfighter
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its contributors
   may be used to endorse or promote products derived from this software
   without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

## Slick2D

Slick2D is distributed under the BSD 3-Clause License. Its upstream notice is reproduced below.

BSD 3-Clause License

Copyright (c) 2013, Slick2D
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the Slick2D nor the names of its contributors may be
   used to endorse or promote products derived from this software without
   specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

## LWJGL 2

LWJGL 2 is distributed under a BSD-style license. Its upstream notice is reproduced below.

Copyright (c) 2002-2007 Lightweight Java Game Library Project
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are
met:

- Redistributions of source code must retain the above copyright
  notice, this list of conditions and the following disclaimer.

- Redistributions in binary form must reproduce the above copyright
  notice, this list of conditions and the following disclaimer in the
  documentation and/or other materials provided with the distribution.

- Neither the name of 'Light Weight Java Game Library' nor the names of
  its contributors may be used to endorse or promote products derived
  from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
"AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED
TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR
CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF
LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

## JInput

JInput is distributed under a BSD-style license. The desktop package includes the applicable upstream notice in `licenses/JINPUT-BSD.txt`.

## JOrbis / Jogg

JOrbis and Jogg are used only as unmodified, separately bundled Java runtime jars on the desktop classpath. JOrbis Maven metadata identifies "GNU Lesser General Public License"; source headers identify the GNU Library General Public License, version 2 or later. Re-linking remains possible because the jars are shipped as separate files in `lib/` rather than merged into the game jar. The desktop package includes the GNU Library GPL v2 text in `licenses/GNU-LIBRARY-GPL-2.0.txt`.

The desktop package also includes corresponding source artifacts:

- `third-party-sources/jogg-0.0.7-jcraft-jorbis-28592f3-source.zip`
- `third-party-sources/jorbis-0.0.17-sources.jar`

Upstream/source reference: `http://www.jcraft.com/jorbis/`

## Gson 2.11.0

Gson is distributed under the Apache License 2.0. The bundled jar includes Maven metadata identifying `com.google.code.gson:gson:2.11.0` and the Apache 2.0 license. The desktop package includes the Apache 2.0 text in `licenses/APACHE-2.0.txt`.

## OpenAL Soft

The bundled OpenAL native libraries identify themselves as OpenAL Soft 1.14. They are documented separately from LWJGL in `desktop/licenses/README.md`; the desktop package includes the GNU Library GPL v2 text in `licenses/GNU-LIBRARY-GPL-2.0.txt` and the corresponding source archive in `third-party-sources/openal-soft-1.14.tar.bz2`.
