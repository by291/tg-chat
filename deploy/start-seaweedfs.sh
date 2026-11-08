#!/bin/sh
set -eu

# Keep master, object, and filer metadata on the same explicitly mounted persistence volume.
mkdir -p /data/master /data/volumes /data/filer

exec weed server \
    -ip=seaweedfs \
    -ip.bind=0.0.0.0 \
    -dir=/data/volumes \
    -master.dir=/data/master \
    -master.telemetry=false \
    -master.volumeSizeLimitMB=128 \
    -volume.max=4 \
    -volume.preStopSeconds=1 \
    -filer \
    -filer.exposeDirectoryData=false \
    -s3 \
    -s3.config=/etc/seaweedfs/s3.json \
    -s3.port.iceberg=0 \
    -s3.port.lance=0
