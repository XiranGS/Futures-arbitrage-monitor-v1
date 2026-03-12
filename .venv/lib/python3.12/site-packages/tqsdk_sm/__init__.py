#!/usr/bin/env python
#  -*- coding: utf-8 -*-
__author__ = 'chengzhi'

from pathlib import Path


def get_sm_path():
    return Path(__file__, "../sm").resolve()
